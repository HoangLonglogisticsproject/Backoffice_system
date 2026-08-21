-- 0010_canonical_email_identity.sql — case-insensitive identity, at the database.
--
-- BUSINESS RULE: `uyen@hoanglongti.com` and `Uyen@hoanglongti.com` are ONE
-- account identity and must not exist side by side. `uyen@hoanglongti.com` and
-- `phuonguyen@hoanglongti.com` are two different people and both are valid —
-- this constrains case and whitespace, never the local part itself.
--
-- WHAT WAS ALREADY TRUE, AND WHY IT WAS NOT ENOUGH.
--
-- The application already canonicalises: `normalizeSubject` in `user.entity.ts`
-- and `normalizeEmail` in `domain/email.ts` both trim and lowercase, and
-- `IdentityRepository` applies the first on every read and every write. Measured
-- over HTTP before this file existed, the API answered correctly at every turn:
--
--   POST .../account-invitations  test01@hoanglongti.com    201
--   POST .../account-invitations  Test01@hoanglongti.com    409 CONFLICT
--   POST .../account-invitations  "  TEST01@HoangLongTI.com  "  409 CONFLICT
--   POST /users                   USR01@HoangLongTI.com     409 CONFLICT
--
-- The gap was WHERE that guarantee lived. Both unique constraints indexed the
-- RAW column, so they enforced a case-SENSITIVE rule and the case-insensitive
-- one existed only in TypeScript. Bypassing the application proved it — plain
-- SQL, no application involved:
--
--   INSERT INTO account_invitations (..., email, ...) VALUES ('TEST01@…')
--   INSERT 0 1        ← uq_pending_invitation_email did not object
--   → two pending invitations for one person
--
--   INSERT INTO identities (..., subject, ...) VALUES ('USR01-DUP@…')
--   INSERT 0 1        ← UNIQUE (provider, subject) did not object
--
-- And the second one is worse than a duplicate. Login lowercases the subject
-- before comparing it to the raw column, so a mixed-case row can never be
-- matched by anybody: the account is unreachable, permanently. Verified — 401.
--
-- So this file moves the invariant from "every caller remembers" to "the
-- database refuses".
--
-- ★ PROVIDER SCOPE. Both new indexes are PARTIAL and neither touches a
-- federated provider. An OIDC/SAML `sub` is an opaque, CASE-SENSITIVE string by
-- specification, so lowercasing one would corrupt it. Email canonicalisation is
-- a rule about EMAIL, and `provider = 'local'` is the only place email is what
-- `subject` means. `identities_provider_subject_key` from 0001 stays exactly as
-- it is and keeps covering every provider, this one included.
--
-- WHY NOT `CREATE INDEX CONCURRENTLY`: same reason as 0009 — the runner wraps
-- each file in a transaction and CONCURRENTLY cannot run inside one. See the
-- note there for the hand-built path a large deployment should take.
--
-- FORWARD ONLY. Undoing this is `DROP INDEX` plus recreating the raw index from
-- 0007; nothing here holds data of its own.

-- ---------------------------------------------------------------- audit ----
--
-- REFUSES TO APPLY RATHER THAN REPAIRING ANYTHING.
--
-- `CREATE UNIQUE INDEX` would fail on conflicting data by itself, but it would
-- fail with a message naming an index nobody has heard of yet. These blocks
-- fail first and say which rows, so the operator can decide.
--
-- ★ AND THEY DECIDE, NOT THIS FILE. Merging two accounts means choosing which
-- one keeps its history; lowercasing a subject changes who can sign in. Neither
-- is a migration's call, so nothing here writes to either table.

DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(format('%s (%s rows: %s)', canonical, n, variants), '; ')
    INTO offending
    FROM (
      SELECT lower(btrim(email)) AS canonical,
             count(*)            AS n,
             string_agg(quote_literal(email), ', ') AS variants
        FROM account_invitations
       WHERE status = 'pending'
       GROUP BY lower(btrim(email))
      HAVING count(*) > 1
    ) AS duplicates;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0010 stopped: pending invitations collide once canonicalised — %',
      offending
      USING HINT =
        'Decide which invitation stands and reject the others through the API '
        '(POST /account-invitations/:id/reject), then run this migration again. '
        'Do not delete rows.';
  END IF;
END $$;

DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(format('%s (%s rows: %s)', canonical, n, variants), '; ')
    INTO offending
    FROM (
      SELECT lower(btrim(subject)) AS canonical,
             count(*)              AS n,
             string_agg(quote_literal(subject), ', ') AS variants
        FROM identities
       WHERE provider = 'local'
       GROUP BY lower(btrim(subject))
      HAVING count(*) > 1
    ) AS duplicates;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0010 stopped: local identities collide once canonicalised — %',
      offending
      USING HINT =
        'Two accounts are the same person. Decide which one keeps its history, '
        'disable the other (PATCH /users/:userId/status), and re-run. '
        'Do not delete accounts — memberships and audit rows point at them.';
  END IF;
END $$;

-- Non-canonical but NOT colliding: the index below would accept these, and they
-- are still wrong. A stored `Uyen@…` is unreachable — every lookup lowercases
-- first — so the account exists and nobody can sign in to it. Reported rather
-- than rewritten, for the same reason as above: making it reachable is a
-- decision about an account.
DO $$
DECLARE
  invitations bigint;
  locals      bigint;
BEGIN
  SELECT count(*) INTO invitations
    FROM account_invitations
   WHERE status = 'pending' AND email <> lower(btrim(email));

  SELECT count(*) INTO locals
    FROM identities
   WHERE provider = 'local' AND subject <> lower(btrim(subject));

  IF invitations > 0 OR locals > 0 THEN
    RAISE EXCEPTION
      'Migration 0010 stopped: % pending invitation(s) and % local identity(ies) '
      'are not canonical.', invitations, locals
      USING HINT =
        'These rows are already unreachable: every lookup canonicalises first. '
        'Canonicalise them deliberately — '
        'UPDATE identities SET subject = lower(btrim(subject)) '
        'WHERE provider = ''local'' AND subject <> lower(btrim(subject)); '
        'and the same shape for account_invitations — then re-run. '
        'Check first that this creates no duplicate.';
  END IF;
END $$;

-- ------------------------------------------------ pending invitations ----
--
-- Replaces the raw-column index from 0007. Dropped rather than kept alongside:
-- the raw one is strictly weaker, and two unique indexes over the same rule are
-- two things to reason about when one of them is edited.
--
-- `lower(btrim(email))` rather than `lower(email)` so the expression is exactly
-- `normalizeEmail`. An index that canonicalises differently from the code is
-- worse than no index, because both look right in isolation.
--
-- `findPendingByEmail` matches on this same expression, so the lookup the
-- service does before inserting uses this index and tests the same predicate
-- the constraint enforces.
DROP INDEX IF EXISTS uq_pending_invitation_email;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_invitation_email_canonical
  ON account_invitations (lower(btrim(email)))
  WHERE status = 'pending';

-- ---------------------------------------------------- local identities ----
--
-- ADDED ALONGSIDE `identities_provider_subject_key`, never replacing it. That
-- constraint is the one that covers every provider; this one adds the stricter
-- rule that only holds where `subject` is an email.
--
-- No `provider` column in the key: the WHERE clause already pins it to one
-- value, so every indexed row shares it and including it would index a
-- constant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_local_identity_subject_canonical
  ON identities (lower(btrim(subject)))
  WHERE provider = 'local';
