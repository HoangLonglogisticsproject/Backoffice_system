-- 0005_identity_credential_state.sql — is this credential still a temporary one?
--
-- One column, on `identities` rather than on `users`, and that placement is the
-- decision worth recording: "this password was issued by somebody else and has
-- not been changed yet" is a fact about a CREDENTIAL, not about a person. A user
-- who later gains an SSO identity must not drag a meaningless flag along with
-- them, and a user with two credentials could legitimately have one temporary
-- and one not.
--
-- ARRIVES IN PHASE 2, not Phase 3 where the provisioning flows live, because the
-- authorization context is what has to report it: a caller holding an unchanged
-- temporary credential has authenticated but has not finished provisioning, and
-- `can()` denies them everything until they have. A context that could not see
-- this column would have to guess, and guessing "false" is the unsafe guess.
--
-- No backfill needed: every existing credential was chosen by its owner, which
-- is exactly what `false` means.

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS must_change_secret BOOLEAN NOT NULL DEFAULT false;
