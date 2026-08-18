-- 0004_authorization.sql — what a person is allowed to do.
--
-- ONE table. Not three, and the absence of `roles` and `role_permissions` is a
-- decision: this deployment has exactly three role contracts and they are named
-- in code, because a guard references them by name. A table holding three rows
-- nobody may edit is a table that only adds a join.
--
-- So the only thing that is DATA here is the ASSIGNMENT — who holds which role,
-- over what, right now. That is precisely what must be changeable without a
-- deploy, and precisely what "SuperAdmin must not be hardcoded" means.
--
-- Membership (0003) says where a person sits. This says what they may do. Two
-- tables because they answer different questions and change for different
-- reasons — a head who moves department keeps being a person, and stops being a
-- head, and those are two separate facts.
--
-- MEMBER IS NOT STORED. Being an ordinary member is the absence of an elevated
-- assignment, not a row. A row saying "MEMBER" would be a second place where
-- membership is recorded, free to disagree with 0003 about the same person.

-- ------------------------------------------------------------ FK target ----
-- Exists ONLY so the foreign key below can reference it. `id` is already the
-- primary key, so this constraint is satisfied by construction and costs an
-- index PostgreSQL creates anyway.
--
-- It carries `status` because that is the whole trick: putting the membership's
-- status INSIDE the referenced key is what makes "ending a membership while its
-- head assignment is still active" a foreign key violation rather than a rule
-- somebody has to remember.
--
-- Guarded by hand: ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS.
--
-- The guard is qualified by `conrelid`, not by name alone. Constraint names in
-- `pg_constraint` are unique per TABLE, not per database, so a name check on its
-- own reports "already there" because some other schema has a constraint of the
-- same name — and then this ALTER is skipped and the foreign key below has no
-- target. Resolving `department_memberships::regclass` through the search_path
-- asks about THIS schema's table, which is the question actually being asked.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_membership_fk_target'
       AND conrelid = 'department_memberships'::regclass
  ) THEN
    ALTER TABLE department_memberships
      ADD CONSTRAINT uq_membership_fk_target
      UNIQUE (id, user_id, department_id, status);
  END IF;
END $$;

-- ------------------------------------------------------- role_assignments ----
CREATE TABLE IF NOT EXISTS role_assignments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id),

  -- Two values, not three: MEMBER is the absence of a row (see header).
  role_key       TEXT        NOT NULL CHECK (role_key IN ('SUPERADMIN', 'DEPARTMENT_HEAD')),

  scope_type     TEXT        NOT NULL CHECK (scope_type IN ('GLOBAL', 'DEPARTMENT')),
  scope_id       UUID        REFERENCES departments(id),

  -- Which membership entitles this person to be head here. NULL for SUPERADMIN,
  -- who sits above departments and therefore needs no membership at all.
  membership_id  UUID,

  status         TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'revoked')),

  -- PROVENANCE. `bootstrap` means the CLI did it and there was no actor inside
  -- the system to name — the first SuperAdmin has nobody above them. Making
  -- that explicit is what allows `granted_by` to be nullable without the NULL
  -- becoming ambiguous later.
  granted_via    TEXT        NOT NULL CHECK (granted_via IN ('api', 'bootstrap')),
  granted_by     UUID        REFERENCES users(id),
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Symmetrical for revocation. Without `revoked_via`, a NULL `revoked_by`
  -- cannot be told apart from a column somebody forgot to fill in, and an audit
  -- column that cannot explain itself is not an audit column.
  revoked_via    TEXT        CHECK (revoked_via IS NULL OR revoked_via IN ('api', 'bootstrap')),
  revoked_by     UUID        REFERENCES users(id),
  revoked_at     TIMESTAMPTZ,

  -- The switch that turns the foreign key below on and off.
  --
  -- 'active' only while this row is an ACTIVE head assignment; NULL otherwise.
  -- Under MATCH SIMPLE a foreign key whose columns include a NULL is not checked
  -- at all — so revoked assignments and GLOBAL assignments exempt themselves,
  -- and only live head assignments are held to the membership rule.
  requires_membership_status TEXT
    GENERATED ALWAYS AS (
      CASE WHEN role_key = 'DEPARTMENT_HEAD' AND status = 'active' THEN 'active' END
    ) STORED,

  -- A department-scoped row names a department; a global one does not.
  CONSTRAINT role_assignments_scope_shape
    CHECK ((scope_type = 'DEPARTMENT') = (scope_id IS NOT NULL)),

  -- Role and scope cannot tell two different stories.
  CONSTRAINT role_assignments_role_scope_agree
    CHECK ((role_key = 'SUPERADMIN') = (scope_type = 'GLOBAL')),

  -- Only a head assignment points at a membership, and it always does.
  CONSTRAINT role_assignments_head_has_membership
    CHECK ((role_key = 'DEPARTMENT_HEAD') = (membership_id IS NOT NULL)),

  CONSTRAINT role_assignments_revoke_state
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),

  CONSTRAINT role_assignments_grant_provenance
    CHECK ((granted_via = 'api') = (granted_by IS NOT NULL)),

  CONSTRAINT role_assignments_revoke_paired
    CHECK ((revoked_via IS NULL) = (revoked_at IS NULL)),

  CONSTRAINT role_assignments_revoke_provenance
    CHECK (revoked_via IS NULL OR ((revoked_via = 'api') = (revoked_by IS NOT NULL))),

  -- ★ AN ACTIVE HEAD MUST HOLD AN ACTIVE MEMBERSHIP OF THE SAME DEPARTMENT.
  --
  -- A CHECK cannot read another table and a foreign key cannot target a partial
  -- index, so neither of the obvious tools works. This does, and it works in
  -- both directions: granting a head assignment to somebody whose membership is
  -- elsewhere fails, AND ending that membership while the assignment is active
  -- fails, because `status` is part of the referenced key and NO ACTION rejects
  -- an update that would break the reference.
  CONSTRAINT role_assignments_head_membership_matches
    FOREIGN KEY (membership_id, user_id, scope_id, requires_membership_status)
    REFERENCES department_memberships (id, user_id, department_id, status)
);

-- ★ At most ONE active SuperAdmin in the entire deployment.
--
-- The indexed column is constant across every indexed row — every row here has
-- role_key = 'SUPERADMIN' — so a second one collides with the first. Handing
-- over therefore means revoke-then-grant inside one transaction; doing it the
-- other way round cannot be committed at all.
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_superadmin
  ON role_assignments (role_key)
  WHERE role_key = 'SUPERADMIN' AND status = 'active';

-- ★ At most ONE active head per department.
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_head_per_department
  ON role_assignments (scope_id)
  WHERE role_key = 'DEPARTMENT_HEAD' AND status = 'active';

-- The authorization context loads by user on every authorized request.
CREATE INDEX IF NOT EXISTS idx_role_assignment_user_active
  ON role_assignments (user_id)
  WHERE status = 'active';
