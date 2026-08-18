-- 0006_membership_change_requests.sql — PROJECT-OWNED (Hoàng Long policy).
--
-- NOT part of the reusable foundation. "A head proposes, a global administrator
-- decides" is one company's approval policy, not a mechanism every backoffice
-- needs — another deployment may simply grant its heads `unit.member.write` and
-- delete this table together with the capability that owns it. `core/` never
-- learns this table exists.
--
-- Two actions, and neither of them is "add":
--
--   TRANSFER_MEMBER  move somebody from the unit they are in to another
--   REMOVE_MEMBER    offboard them from the organization entirely
--
-- There is no ADD_MEMBER because there is no state it could act on: an active
-- person always belongs to exactly one unit, so putting them somewhere means
-- taking them out of where they are.
--
-- THE SOURCE DEPARTMENT IS RECORDED, NOT SUPPLIED. It is read from the target's
-- active membership when the request is written, and read AGAIN when it is
-- approved — a request created while somebody sat in A may be approved after
-- they moved to C, and honouring the stale value would move the wrong person
-- out of the wrong place.

CREATE TABLE IF NOT EXISTS membership_change_requests (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Where the target was when this was raised. Derived from their membership,
  -- never accepted from a caller.
  department_id         UUID        NOT NULL REFERENCES departments(id),

  -- Where they should end up. Only a transfer has one.
  target_department_id  UUID        REFERENCES departments(id),

  -- The person being moved or offboarded. A real account: this flow is for
  -- people who already exist, and `account_invitations` covers the rest.
  target_user_id        UUID        NOT NULL REFERENCES users(id),

  action                TEXT        NOT NULL
                                    CHECK (action IN ('TRANSFER_MEMBER', 'REMOVE_MEMBER')),

  status                TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'approved', 'rejected')),

  requested_by          UUID        NOT NULL REFERENCES users(id),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by            UUID        REFERENCES users(id),
  decided_at            TIMESTAMPTZ,
  reason                TEXT,

  -- A transfer names a destination; an offboarding cannot.
  CONSTRAINT requests_target_matches_action
    CHECK ((action = 'TRANSFER_MEMBER') = (target_department_id IS NOT NULL)),

  -- Moving somebody to where they already are is not a transfer.
  CONSTRAINT requests_transfer_moves_somewhere
    CHECK (target_department_id IS NULL OR target_department_id <> department_id),

  -- ★ NOBODY APPROVES THEIR OWN REQUEST. Enforced here as well as by the
  -- permission model, because two independent layers is what makes it hold when
  -- one of them is changed by somebody who did not know about the other.
  CONSTRAINT requests_no_self_approval
    CHECK (decided_by IS NULL OR decided_by <> requested_by),

  -- ★ No hybrid decision state. Written as a CASE rather than an equality: the
  -- equality form `(status='pending') = (decided_by IS NULL AND decided_at IS NULL)`
  -- accepts an approved row with only ONE of the two columns filled, because
  -- "not both null" is satisfied by "exactly one null". A real PostgreSQL run
  -- proved that hole before this file was written.
  CONSTRAINT requests_decision_state CHECK (
    CASE status
      WHEN 'pending' THEN decided_by IS NULL     AND decided_at IS NULL
      ELSE                decided_by IS NOT NULL AND decided_at IS NOT NULL
    END
  )
);

-- ★ One open request per person per action.
--
-- A second head asking for the same move while the first request is still
-- undecided produces two workflows that cannot both succeed, and a global
-- administrator deciding the same thing twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_membership_request
  ON membership_change_requests (department_id, target_user_id, action)
  WHERE status = 'pending';

-- The queue a head sees for their own unit.
CREATE INDEX IF NOT EXISTS idx_membership_request_department
  ON membership_change_requests (department_id)
  WHERE status = 'pending';
