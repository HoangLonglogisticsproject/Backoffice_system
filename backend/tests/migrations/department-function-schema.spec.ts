import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Asserts the SHAPE of 0032 without a database.
 *
 * The one thing this file must never do is decide which department is which:
 * a seeded `UPDATE departments SET function = 'dispatch' WHERE slug = 'dieu-do'`
 * would be the migration inventing a fact about one company's org chart. So
 * the assertions here are as much about what is ABSENT as about what is there.
 */
describe('0032_department_function.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0032_department_function.sql'), 'utf8');
  });

  const normalized = (): string => sql.replace(/\s+/g, ' ');
  /** The file with its `--` comments removed, so prose cannot trip a check. */
  const code = (): string => sql.replace(/--[^\n]*/g, '');

  it('adds exactly one nullable column, guarded so it can run twice', () => {
    expect(normalized()).toContain('ALTER TABLE departments ADD COLUMN IF NOT EXISTS function TEXT');
    // Nullable, and no default: adding the column grants nothing to anybody.
    expect(code()).not.toMatch(/function\s+TEXT\s+NOT NULL/i);
    expect(code()).not.toMatch(/DEFAULT\s+'/i);
  });

  it('★ constrains the value to the three functions the business named, or NULL', () => {
    expect(normalized()).toContain(
      "CHECK (function IS NULL OR function IN ('sales', 'accounting', 'dispatch'))",
    );
  });

  it('adds the CHECK inside a duplicate-tolerant block — the 0018 pattern', () => {
    expect(normalized()).toContain('WHEN duplicate_object THEN NULL');
  });

  it('bounds how long it will wait for the ACCESS EXCLUSIVE lock — the 0027 pattern', () => {
    // `departments` is read by `loadContext` on every authorized request; a
    // DDL queued behind a long transaction would queue all of them behind it.
    expect(code()).toMatch(/SET LOCAL lock_timeout = '5s';/);
  });

  it('creates no table and no index', () => {
    expect(code()).not.toMatch(/CREATE TABLE/i);
    expect(code()).not.toMatch(/CREATE (UNIQUE )?INDEX/i);
  });

  it('★ seeds nothing and names no department — which unit is which is data', () => {
    expect(code().toUpperCase()).not.toContain('INSERT INTO');
    expect(code()).not.toMatch(/UPDATE\s+departments/i);
    expect(code()).not.toMatch(/WHERE\s+slug/i);
  });
});
