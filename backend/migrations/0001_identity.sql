-- 0001_identity.sql — who a person is, and how they prove it.
--
-- Three tables, and each one earns its place:
--
--   users       the stable identity. Everything later — memberships, roles,
--               audit records — points here, so this row must outlive any
--               particular way of logging in. It is never hard-deleted.
--
--   identities  HOW that user proves who they are. Separate from `users` so a
--               deployment can move from passwords to SSO without touching the
--               user, and so one user can hold several credentials at once.
--               Phase 1 issues only `provider = 'local'`.
--
--   sessions    server-side, because "log out" has to actually log out. A
--               stateless token cannot be revoked without a denylist, which is
--               a session table wearing a disguise — so this is the honest
--               version of the same storage, and it needs no crypto of its own.
--
-- No departments, roles, permissions or capabilities here. Those are later
-- phases and are not needed to answer "who is calling".

-- ---------------------------------------------------------------- users ----
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  TEXT        NOT NULL CHECK (length(trim(display_name)) > 0),

  -- Lifecycle is disable, never delete: audit trails and authored records keep
  -- referencing this row long after the person leaves.
  status        TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'disabled')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------- identities ----
CREATE TABLE IF NOT EXISTS identities (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'local' today. 'oidc', 'saml' … slot in here without a schema change,
  -- which is the whole reason this is not a column on `users`.
  provider     TEXT        NOT NULL,

  -- What the provider calls this user: an email for `local`, an issuer subject
  -- for OIDC. Normalised to lower case by the application before it arrives.
  subject      TEXT        NOT NULL,

  -- Populated for `local` only: providers that verify elsewhere store nothing
  -- secret here, which is why this is nullable rather than NOT NULL.
  secret_hash  TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One subject per provider. Registering the same email twice is a conflict,
  -- not a second account.
  CONSTRAINT identities_provider_subject_key UNIQUE (provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_identities_user_id ON identities (user_id);

-- ------------------------------------------------------------- sessions ----
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The HASH of the token, never the token. A dump of this table hands over
  -- no live session; the bearer value exists only in the client's hands.
  token_hash  TEXT        NOT NULL,

  expires_at  TIMESTAMPTZ NOT NULL,

  -- Set on logout. Kept rather than deleted so "when did this end, and how"
  -- stays answerable.
  revoked_at  TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions (user_id);
-- Supports the periodic sweep of dead sessions.
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
