-- Driver accounts, and the request that produces one.
--
-- ★ TWO THINGS THE EXISTING MODEL COULD NOT SAY.
--
-- 1. WHAT KIND OF ACCOUNT THIS IS. Nothing in the schema distinguished a driver
--    from an employee, and it cannot be inferred: "has no active department
--    membership" is also true of every offboarded employee. So the answer has
--    to be stored rather than derived.
--
-- 2. A REQUEST WITH NO DEPARTMENT. `account_invitations` already models
--    "somebody proposes an account, a global administrator decides" — but its
--    `department_id` is NOT NULL, is re-checked at approval time ("the
--    requester no longer leads that department"), and scopes its listing. A
--    driver belongs to no department, so reusing that table would mean making
--    its central column optional for one of two different business objects
--    sharing one row shape. It also throws its rejection reason away, and a
--    driver request must keep one.
--
-- What IS reused is the shape: the three CHECK constraints below are the same
-- ones `account_invitations` uses, for the same reasons.

-- =========================================================== account type ==

-- ★ DEFAULT 'employee', AND THAT IS THE MIGRATION'S WHOLE SAFETY ARGUMENT.
--
-- Every row that exists today was created through employee provisioning, which
-- enrolls a department membership in the same transaction. Calling them
-- employees is a statement of what already happened, not an assumption about
-- what they are — so this backfill invents nothing.
--
-- No default is added for FUTURE rows in the sense of a business rule: the
-- driver path passes 'driver' explicitly, and the employee path keeps working
-- untouched because 'employee' is what it would have written anyway.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'employee';

DO $$
BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_account_type
    CHECK (account_type IN ('employee', 'driver'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Every "is this caller a driver" check reads this column on the session's
-- user, so it is worth an index only if that read ever stops being by primary
-- key. It is not: the lookup is always `WHERE id = $1`. No index added.

-- ================================================== driver account request ==

CREATE TABLE IF NOT EXISTS driver_account_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ★ NO department_id, AND THAT IS THE POINT OF A SEPARATE TABLE. A driver
  -- belongs to no unit; there is nothing here to record one against.

  -- The person being proposed. Normalised before it arrives. No foreign key:
  -- there is no account yet, which is the entire reason this row exists.
  email            TEXT        NOT NULL,
  -- Proposed by the requester and used verbatim when the account is created.
  display_name     TEXT        NOT NULL CHECK (length(trim(display_name)) > 0),

  -- ⚠ THERE IS NO PASSWORD COLUMN HERE, AND THERE MUST NEVER BE ONE. A pending
  -- request can sit for days; a temporary secret stored for that long is a
  -- secret with a window. The password is generated at APPROVAL by the same
  -- provisioning path the invitation flow uses, handed to the approver once,
  -- and stored only as a hash on the identity.

  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected')),

  requested_by     UUID        NOT NULL REFERENCES users(id),
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       UUID        REFERENCES users(id),
  decided_at       TIMESTAMPTZ,

  -- ★ REQUIRED ON REJECTION, WHICH IS WHERE THIS DIFFERS FROM INVITATIONS.
  -- A driver told only "rejected" has nothing to act on, and the head who
  -- proposed them has nothing to correct. The CHECK below makes a reasonless
  -- rejection unstorable rather than merely discouraged.
  decision_reason  TEXT,

  -- The account this request produced. With the CHECK below it makes "approved
  -- but no account exists" a state the database refuses.
  created_user_id  UUID        REFERENCES users(id),

  -- Nobody decides their own request. Test 8 and 9 of the specification.
  CONSTRAINT driver_requests_no_self_approval
    CHECK (decided_by IS NULL OR decided_by <> requested_by),

  -- CASE rather than the equality form: the equality form lets a decided row
  -- through with only one of the two decision columns set.
  CONSTRAINT driver_requests_decision_state CHECK (
    CASE status
      WHEN 'pending' THEN decided_by IS NULL     AND decided_at IS NULL
      ELSE                decided_by IS NOT NULL AND decided_at IS NOT NULL
    END
  ),

  -- APPROVED ⇔ AN ACCOUNT EXISTS.
  CONSTRAINT driver_requests_provisioned
    CHECK ((status = 'approved') = (created_user_id IS NOT NULL)),

  -- REJECTED ⇒ A REASON. Approval needs none: the account itself is the record.
  CONSTRAINT driver_requests_rejection_reason CHECK (
    status <> 'rejected' OR length(trim(coalesce(decision_reason, ''))) > 0
  )
);

-- One pending request per address. A second proposal for somebody already
-- awaiting a decision is a duplicate, not a queue — and this is what makes the
-- concurrency case (test 13) a database refusal rather than a race the service
-- has to win.
CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_request_pending_email
  ON driver_account_requests (email)
  WHERE status = 'pending';

-- The reviewer's queue: pending first, oldest first, so the person waiting
-- longest is decided first.
CREATE INDEX IF NOT EXISTS idx_driver_requests_pending
  ON driver_account_requests (requested_at)
  WHERE status = 'pending';

-- History is read per requester on the head's own screen.
CREATE INDEX IF NOT EXISTS idx_driver_requests_requester
  ON driver_account_requests (requested_by, requested_at DESC);
