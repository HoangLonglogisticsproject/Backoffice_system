-- 0010_canonical_email_identity.sql — case-insensitive identity, at the database.
--
-- BUSINESS RULE: `uyen@hoanglonglti.com` and `Uyen@hoanglonglti.com` are ONE
-- account identity and must not exist side by side. `uyen@hoanglonglti.com` and
-- `phuonguyen@hoanglonglti.com` are two different people and both are valid —
-- this constrains case and surrounding whitespace, never the local part.
--
-- WHAT WAS ALREADY TRUE, AND WHY IT WAS NOT ENOUGH.
--
-- The application already canonicalises: `normalizeSubject` in `user.entity.ts`
-- and `normalizeEmail` in `domain/email.ts` both trim and lowercase, and
-- `IdentityRepository` applies the first on every read and every write. Measured
-- over HTTP before this file existed, the API answered correctly at every turn:
--
--   POST .../account-invitations  test01@hoanglonglti.com       201
--   POST .../account-invitations  Test01@hoanglonglti.com       409 CONFLICT
--   POST .../account-invitations  "  TEST01@HoangLongLTI.com  " 409 CONFLICT
--   POST /users                   USR01@HoangLongLTI.com        409 CONFLICT
--
-- The gap was WHERE that guarantee lived. Both unique constraints indexed the
-- RAW column, so they enforced a case-SENSITIVE rule and the case-insensitive
-- one existed only in TypeScript. Bypassing the application proved it — plain
-- SQL, no application involved:
--
--   INSERT INTO account_invitations (..., email, ...) VALUES ('TEST01@…')
--   INSERT 0 1        ← uq_pending_invitation_email did not object
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

-- --------------------------------------------------- preconditions ----
--
-- ★ REQUIRES server_encoding = UTF8. `canonical_identity` below is written with
-- `E'\uXXXX'` escapes, and PostgreSQL only accepts those in a UTF8 database —
-- elsewhere they raise "unsafe use of \u", from inside a function body, which
-- reads like a syntax error rather than like a deployment that cannot host this
-- rule. Checked here so the failure names the actual problem.
--
-- `lock_timeout` because this file takes ACCESS EXCLUSIVE twice: DROP INDEX and
-- ADD CONSTRAINT both do. Without it, a migration that lands behind one long
-- transaction waits forever AND queues every other query behind itself — a
-- deploy that quietly takes the site down. Five seconds, then fail and retry
-- when the database is quieter. SET LOCAL, so it reverts with the transaction
-- the runner already wraps this file in.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION
      'Migration 0010 requires server_encoding = UTF8, found %.',
      current_setting('server_encoding')
      USING HINT =
        'The canonical form folds Unicode whitespace (NBSP, BOM, the U+2000 '
        'block). A non-UTF8 database cannot represent those code points, so the '
        'rule cannot be enforced there. Recreate the database with UTF8.';
  END IF;
END $$;

-- ----------------------------------------------- the canonical form ----
--
-- ONE DEFINITION, used by both indexes, by both audits below, and by
-- `AccountInvitationRepository.findPendingByEmail`. Written out at each of those
-- call sites instead, it would be five copies of an expression that is only
-- correct while all five agree.
--
-- ★ THE CHARACTER SET IS ECMAScript's, NOT PostgreSQL's, and that is the point.
-- `normalizeEmail` is `email.trim().toLowerCase()`, and JavaScript's `trim`
-- strips every WhiteSpace and LineTerminator code point. PostgreSQL's bare
-- `btrim(x)` strips U+0020 and NOTHING ELSE; its regex `\s` adds the ASCII
-- controls but still not U+00A0 or U+FEFF. Measured, per code point:
--
--                    JS trim   btrim(x)   regex \s   this function
--   U+0020 SPACE       yes       yes        yes          yes
--   U+0009 TAB         yes       NO         yes          yes
--   U+00A0 NBSP        yes       NO         NO           yes
--   U+FEFF BOM         yes       NO         NO           yes
--   U+3000 IDEOGRAPHIC yes       NO         yes          yes
--
-- A narrower expression here would not be a smaller version of the rule, it
-- would be a DIFFERENT rule: an address padded with U+00A0 and inserted by
-- hand would fail to collide with the plain one, which is precisely the write
-- these indexes exist to catch. So the set is enumerated in full, once, and
-- `canonical-identity.integration.spec.ts` feeds the same code points through
-- `normalizeEmail` and through this function and asserts they agree.
--
-- `btrim(value, characters)` rather than a regex: the set appears once instead
-- of twice (a regex needs it in both the leading and the trailing branch), and
-- there is no pattern to misread. IMMUTABLE because an index expression must
-- be; `lower` and `btrim` both are.
CREATE OR REPLACE FUNCTION canonical_identity(value text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
AS $$
  SELECT lower(
    btrim(
      value,
      -- The ECMAScript WhiteSpace + LineTerminator sets, which is exactly what
      -- `String.prototype.trim` removes. Written as ESCAPES, never as literal
      -- characters: most of these are invisible, and a file that relied on them
      -- surviving an editor or a copy-paste would break silently.
      --
      -- Joined with `||` rather than by adjacency: PostgreSQL's implicit
      -- concatenation of newline-separated constants does not accept the `E`
      -- prefix on the continuations, and fails with a syntax error.
      E'\u0009\u000A\u000B\u000C\u000D'        ||  -- TAB LF VT FF CR
      E'\u0020\u00A0\u1680'                      ||  -- SPACE, NBSP, OGHAM
      E'\u2000\u2001\u2002\u2003\u2004\u2005' ||  -- EN QUAD .. FOUR-PER-EM
      E'\u2006\u2007\u2008\u2009\u200A'        ||  -- SIX-PER-EM .. HAIR
      E'\u2028\u2029'                             ||  -- LINE SEP, PARA SEP
      E'\u202F\u205F\u3000\uFEFF'                   -- NNBSP, MMSP, IDEO, BOM
    )
  );
$$;

-- ★ CHANGING THIS FUNCTION DOES NOT REBUILD THE INDEXES THAT CALL IT.
--
-- `CREATE OR REPLACE FUNCTION` swaps the definition; the two expression indexes
-- below keep the values computed under the OLD one. PostgreSQL does not detect
-- that — it trusts IMMUTABLE — so the index silently stops agreeing with the
-- function: lookups miss rows that are there, and the unique index stops
-- catching collisions it exists to catch. Nothing errors, at any point.
--
-- Any future change to this definition MUST rebuild both, in the same
-- transaction as the change:
--
--   REINDEX INDEX uq_pending_invitation_email_canonical;
--   REINDEX INDEX uq_local_identity_subject_canonical;
--
-- …and revalidate the two CHECK constraints, which are expressions over this
-- same function and are just as stale-able:
--
--   ALTER TABLE identities          VALIDATE CONSTRAINT identities_local_subject_canonical;
--   ALTER TABLE account_invitations VALIDATE CONSTRAINT invitations_pending_email_canonical;
COMMENT ON FUNCTION canonical_identity(text) IS
  'Mirrors normalizeEmail/normalizeSubject: JS-trim then lowercase. '
  'Changing this changes what two rows have to be to collide, and REQUIRES '
  'REINDEX of uq_pending_invitation_email_canonical and '
  'uq_local_identity_subject_canonical plus revalidation of the two canonical '
  'CHECK constraints - see 0010.';

-- ---------------------------------------------------------------- audit ----
--
-- REFUSES TO APPLY RATHER THAN REPAIRING ANYTHING.
--
-- `CREATE UNIQUE INDEX` would fail on conflicting data by itself, but it would
-- fail with a message naming an index nobody has heard of yet. This block fails
-- first and says which rows, so the operator can decide.
--
-- ★ AND THEY DECIDE, NOT THIS FILE. Merging two accounts means choosing which
-- one keeps its history; lowercasing a subject changes who can sign in. Neither
-- is a migration's call, so nothing here writes to either table.
--
-- One block rather than three, with the two status/provider values named once
-- as constants: they are predicates of this migration, not incidental strings,
-- and repeating them invites one copy to be edited without the others.
--
-- ★ 'pending' AND 'local' STILL APPEAR THREE TIMES EACH, AND THAT IS THE FLOOR.
--
-- Once here, once in the partial index predicate, once in the CHECK. A static
-- analyser reads that as a duplicated literal and asks for a constant. There is
-- no constant to reach for: an index predicate and a CHECK expression are DDL,
-- evaluated with no PL/pgSQL scope around them. Measured, not assumed:
--
--   WHERE status = s                      ERROR: column "s" does not exist
--   WHERE status = current_setting(...)   ERROR: functions in index predicate
--                                                must be marked IMMUTABLE
--
-- What DOES compile is an IMMUTABLE function returning the literal — and it is
-- the worst of the three. It hides the predicate from anyone reading the index,
-- and it recreates exactly the hazard documented above `canonical_identity`:
-- CREATE OR REPLACE on that function would leave both indexes built against the
-- old value, silently. Trading a real correctness trap for a lint count is a bad
-- deal at any price.
--
-- So the repetition stays. These are two enum values already fixed by the schema
-- (`CHECK (status IN ('pending','approved','rejected'))` in 0007, and `'local'`
-- as LOCAL_PROVIDER in the application), and the three sites are three different
-- languages that cannot share a binding. If this is flagged again, resolve it in
-- the analyser as intended-by-design; do not add a function to make it go away.
DO $$
DECLARE
  pending_status  CONSTANT text := 'pending';
  local_provider  CONSTANT text := 'local';
  colliding       text;
  stray_invites   bigint;
  stray_locals    bigint;
BEGIN
  -- 1. Pending invitations that become one row once canonicalised.
  --
  -- ★ IDS, NEVER ADDRESSES. This message goes to a migration log, a CI job
  -- output and whatever ships those onward. An email is personal data and a
  -- deploy log is the wrong place to copy it into — the row id is what the
  -- operator needs to act anyway, and it identifies exactly one row.
  SELECT string_agg(format('[%s]', ids), '; ')
    INTO colliding
    FROM (
      SELECT string_agg(id::text, ', ' ORDER BY requested_at) AS ids
        FROM account_invitations
       WHERE status = pending_status
       GROUP BY canonical_identity(email)
      HAVING count(*) > 1
    ) AS duplicates;

  IF colliding IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0010 stopped: pending invitations collide once canonicalised. '
      'Colliding row ids, grouped: %', colliding
      USING HINT =
        'Each group is one person invited under more than one spelling. Decide '
        'which invitation stands and reject the others through the API '
        '(POST /account-invitations/:id/reject), then run this migration again. '
        'Do not delete rows.';
  END IF;

  -- 2. Local identities that become one row once canonicalised.
  -- Same redaction as above, and for the same reason.
  SELECT string_agg(format('[%s]', ids), '; ')
    INTO colliding
    FROM (
      SELECT string_agg(id::text, ', ' ORDER BY created_at) AS ids
        FROM identities
       WHERE provider = local_provider
       GROUP BY canonical_identity(subject)
      HAVING count(*) > 1
    ) AS duplicates;

  IF colliding IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0010 stopped: local identities collide once canonicalised. '
      'Colliding identity row ids, grouped: %', colliding
      USING HINT =
        'Each group is one person holding more than one account. Decide which '
        'keeps its history, disable the other (PATCH /users/:userId/status), '
        'and re-run. Do not delete accounts — memberships and audit rows point '
        'at them.';
  END IF;

  -- 3. Non-canonical but NOT colliding. The indexes below would accept these,
  -- and they are still wrong: a stored `Uyen@…` is unreachable, because every
  -- lookup canonicalises first. Reported rather than rewritten, for the same
  -- reason as above — making it reachable is a decision about an account.
  SELECT count(*) INTO stray_invites
    FROM account_invitations
   WHERE status = pending_status AND email <> canonical_identity(email);

  SELECT count(*) INTO stray_locals
    FROM identities
   WHERE provider = local_provider AND subject <> canonical_identity(subject);

  IF stray_invites > 0 OR stray_locals > 0 THEN
    RAISE EXCEPTION
      'Migration 0010 stopped: % pending invitation(s) and % local identity(ies) '
      'are not canonical.', stray_invites, stray_locals
      USING HINT =
        'These rows are already unreachable: every lookup canonicalises first. '
        'Canonicalise them deliberately with canonical_identity(), for example '
        'SET subject = canonical_identity(subject) on the local identities that '
        'differ, then re-run. Check first that this creates no duplicate.';
  END IF;
END $$;

-- ------------------------------------------------ pending invitations ----
--
-- Replaces the raw-column index from 0007. Dropped rather than kept alongside:
-- the raw one is strictly weaker, and two unique indexes over the same rule are
-- two things to reason about when one of them is edited.
--
-- `findPendingByEmail` matches on `canonical_identity(email)` too, so the lookup
-- the service does before inserting uses this index AND tests the same predicate
-- the constraint enforces.
DROP INDEX IF EXISTS uq_pending_invitation_email;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_invitation_email_canonical
  ON account_invitations (canonical_identity(email))
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
  ON identities (canonical_identity(subject))
  WHERE provider = 'local';

-- --------------------------------------- canonical FORM, not just uniqueness ----
--
-- ★ THE UNIQUE INDEXES ABOVE DO NOT MAKE A ROW CANONICAL. They make two rows
-- that canonicalise alike collide — nothing stops a SINGLE row being stored as
-- `  Uyen@HoangLongLTI.com  `. Measured on the schema as it stood one commit
-- ago: that INSERT succeeded, and both indexes stayed quiet, because
-- `canonical_identity('  Uyen@… ')` was unique among one row.
--
-- For `identities` that is not cosmetic, it is an unreachable account.
-- `findWithUserBySubject` canonicalises the input and compares it to the RAW
-- column, so a non-canonical row can never be matched by anybody — the account
-- exists, nobody can sign in to it, and no error is raised anywhere. Verified:
-- 401, forever.
--
-- The application already writes canonical values at both call sites. These
-- constraints are what makes that true of writes the application did not make —
-- a repair script, a support fix applied by hand, a future repository that
-- forgets. Same reason the unique indexes exist rather than trusting the
-- pre-check.
--
-- ★ SCOPED EXACTLY LIKE THE INDEX ABOVE IT, and for the same reason. An OIDC
-- `sub` is opaque and case-sensitive, so `provider <> 'local'` short-circuits
-- and a federated row is never canonicalised. Same shape on invitations:
-- `status <> 'pending'` leaves decided history alone, so a row that predates
-- this rule stays readable after it is decided.
ALTER TABLE identities
  ADD CONSTRAINT identities_local_subject_canonical
  CHECK (provider <> 'local' OR subject = canonical_identity(subject));

ALTER TABLE account_invitations
  ADD CONSTRAINT invitations_pending_email_canonical
  CHECK (status <> 'pending' OR email = canonical_identity(email));
