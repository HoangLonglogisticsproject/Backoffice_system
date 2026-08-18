-- 0007_account_invitations.sql — PROJECT-OWNED (Hoàng Long policy).
--
-- Bringing in somebody who has no account yet. A head names an email; nothing
-- exists until a global administrator approves, and then everything exists at
-- once.
--
-- WHY THE TARGET IS AN EMAIL AND NOT A user_id: the person being invited has no
-- row to point at. That is the whole difference from
-- `membership_change_requests`, whose target is a real account — and the reason
-- the two are separate tables. One table with both columns would carry two
-- mutually exclusive shapes, and every query would have to remember which
-- branch it was in.
--
-- NO PASSWORD COLUMN, ANYWHERE. The temporary secret is generated during
-- approval, hashed into `identities`, and returned to the approver exactly once.
-- A column here would keep it after the moment it was needed.

CREATE TABLE IF NOT EXISTS account_invitations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Where the invitee lands when approved: the unit of the head who invited
  -- them. Recorded now so the answer cannot drift before the decision.
  department_id    UUID        NOT NULL REFERENCES departments(id),

  -- Normalised before it gets here. No FK — there is nothing to reference yet.
  email            TEXT        NOT NULL,

  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected')),

  requested_by     UUID        NOT NULL REFERENCES users(id),
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       UUID        REFERENCES users(id),
  decided_at       TIMESTAMPTZ,
  reason           TEXT,

  -- The account this invitation produced. Together with the CHECK below and the
  -- foreign key, it makes "approved but no account exists" a state the database
  -- refuses to store — rather than one the service has to remember not to
  -- create.
  created_user_id  UUID        REFERENCES users(id),

  CONSTRAINT invitations_no_self_approval
    CHECK (decided_by IS NULL OR decided_by <> requested_by),

  -- Same CASE form as the request table, for the same reason: the equality form
  -- lets an approved row through with only one of the two decision columns set.
  CONSTRAINT invitations_decision_state CHECK (
    CASE status
      WHEN 'pending' THEN decided_by IS NULL     AND decided_at IS NULL
      ELSE                decided_by IS NOT NULL AND decided_at IS NOT NULL
    END
  ),

  -- ★ APPROVED ⇔ AN ACCOUNT EXISTS.
  CONSTRAINT invitations_provisioned
    CHECK ((status = 'approved') = (created_user_id IS NOT NULL))
);

-- ★ One pending invitation per email, ACROSS THE WHOLE DEPLOYMENT.
--
-- Not per department. A person ends up in exactly one unit, and one email maps
-- to exactly one identity, so two pending invitations for the same address are
-- two workflows of which only one can ever succeed — and a global administrator
-- deciding the same person twice.
--
-- Note what this does NOT cover: once an invitation is approved, this index
-- stops constraining that email. What refuses a second account then is the
-- service checking `identities`, and behind it `UNIQUE (provider, subject)`.
-- Three layers, and this is only the first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_invitation_email
  ON account_invitations (email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_invitation_department
  ON account_invitations (department_id)
  WHERE status = 'pending';
