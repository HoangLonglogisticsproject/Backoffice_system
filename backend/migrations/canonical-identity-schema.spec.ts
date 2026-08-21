import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The SHAPE of 0010, without a database.
 *
 * The behaviour is proven in `canonical-identity.integration.spec.ts` against a
 * real server. What this file catches is the edit that leaves the code working
 * and the guarantee gone: the canonical index quietly dropped, the raw one
 * brought back, or — the one that would be hardest to spot in review — the
 * partial `WHERE provider = 'local'` removed, which would silently impose email
 * rules on a federated provider whose subject is case-sensitive by spec.
 */
describe('0010_canonical_email_identity.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(__dirname, '0010_canonical_email_identity.sql'), 'utf8');
  });

  const code = (): string => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

  /**
   * `code()` with every SQL string literal removed.
   *
   * The audit blocks quote the remediation SQL inside a HINT, so the file
   * legitimately contains the text "UPDATE identities" — as advice for an
   * operator, not as something it runs. Searching the raw text for statements
   * the migration must never execute matches that hint and fails on the wrong
   * thing, which is exactly what happened the first time this spec was written.
   */
  const statements = (): string => code().replace(/'(?:[^']|'')*'/g, "''");

  it('adds no table and no column — this file is constraints only', () => {
    expect(code()).not.toMatch(/CREATE TABLE/i);
    expect(code()).not.toMatch(/ADD COLUMN/i);
  });

  it('★ makes the pending-invitation rule case-insensitive', () => {
    expect(code()).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_invitation_email_canonical ON account_invitations (canonical_identity(email)) WHERE status = \'pending\'',
    );
  });

  it('replaces the raw-column index rather than leaving both in place', () => {
    // Two unique indexes over one rule is two things to reason about when one
    // of them is edited, and the raw one is strictly weaker.
    expect(code()).toContain('DROP INDEX IF EXISTS uq_pending_invitation_email');
  });

  it('★ makes the local identity rule case-insensitive', () => {
    expect(code()).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_local_identity_subject_canonical ON identities (canonical_identity(subject)) WHERE provider = \'local\'',
    );
  });

  it('★ CONFINES that rule to `local` — a federated subject is case-sensitive', () => {
    // The partial predicate is the whole safeguard. Without it this index would
    // lowercase an OIDC/SAML `sub`, which is an opaque case-sensitive string,
    // and two legitimately different subjects would collide.
    const identityIndex = code().slice(code().indexOf('uq_local_identity_subject_canonical'));
    expect(identityIndex).toContain("WHERE provider = 'local'");
  });

  it('leaves the all-provider uniqueness from 0001 alone', () => {
    // `identities_provider_subject_key` is what covers every provider. 0010
    // adds a stricter rule beside it; it must not replace it.
    expect(code()).not.toContain('identities_provider_subject_key');
  });

  it('canonicalises through ONE definition, not a copy at each site', () => {
    // Both indexes, all three audits and `findPendingByEmail` go through the
    // same function. Written out at each site it would be five expressions that
    // are only correct while all five agree.
    expect(code()).toContain('canonical_identity(email)');
    expect(code()).toContain('canonical_identity(subject)');
    // The trimming itself appears exactly once — inside the function body.
    expect(code().match(/btrim\(/g)).toHaveLength(1);
  });

  it('★ declares the function IMMUTABLE — an index expression cannot be less', () => {
    expect(code()).toContain('CREATE OR REPLACE FUNCTION canonical_identity(value text)');
    expect(code()).toContain('IMMUTABLE');
  });

  it("★ trims JavaScript's whitespace set, not PostgreSQL's", () => {
    // `normalizeEmail` is `trim().toLowerCase()`, and bare `btrim(x)` strips
    // U+0020 alone — so an address padded with a tab or an NBSP and inserted by
    // hand would fail to collide with the plain one. Every code point
    // `String.prototype.trim` removes has to be named here.
    const required = [
      '0009', '000A', '000B', '000C', '000D',
      '0020', '00A0', '1680',
      '2000', '2001', '2002', '2003', '2004', '2005',
      '2006', '2007', '2008', '2009', '200A',
      '2028', '2029',
      '202F', '205F', '3000', 'FEFF',
    ];
    for (const codePoint of required) {
      expect(code()).toContain(`\\u${codePoint}`);
    }
  });

  it('carries no literal whitespace of its own — every one is an escape', () => {
    // Half of that set is invisible. A file that relied on the characters
    // themselves surviving an editor — or a copy-paste, which is how this very
    // spec first got written wrong — would break without a visible diff.
    //
    // The needles are BUILT from code points rather than typed, for the same
    // reason: a literal NBSP in this assertion would be exactly as invisible
    // as the one it is looking for.
    const invisible = [
      0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
      0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
      0xfeff,
    ].map((point) => String.fromCodePoint(point));

    for (const character of invisible) {
      expect(sql).not.toContain(character);
    }
  });

  it('★ REFUSES to apply on conflicting data instead of repairing it', () => {
    // Merging two accounts means choosing which keeps its history, and
    // lowercasing a subject changes who can sign in. Neither is a migration's
    // decision, so this file must raise and stop.
    expect(code()).toMatch(/RAISE EXCEPTION/);

    // Against the STATEMENTS, not the raw text — the hints quote remediation
    // SQL deliberately, and advice is not an action.
    expect(statements()).not.toMatch(/\bUPDATE\s+identities\b/i);
    expect(statements()).not.toMatch(/\bUPDATE\s+account_invitations\b/i);
    expect(statements()).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('audits both tables before creating either index', () => {
    const body = code();
    const firstIndex = body.indexOf('CREATE UNIQUE INDEX');
    const audits = body.slice(0, firstIndex);

    expect(audits).toContain('account_invitations');
    expect(audits).toContain('identities');
    expect(audits.match(/RAISE EXCEPTION/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
