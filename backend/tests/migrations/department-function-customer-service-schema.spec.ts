import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Asserts the SHAPE of 0033 without a database.
 *
 * The migration widens one CHECK and touches nothing else. As with 0032, the
 * assertions are as much about what is ABSENT — no rewrite of 0032, no seed,
 * no department named — as about what is there.
 */
describe('0033_department_function_customer_service.sql', () => {
  let sql: string;
  let previous: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0033_department_function_customer_service.sql'), 'utf8');
    previous = await readFile(join(MIGRATIONS_DIR, '0032_department_function.sql'), 'utf8');
  });

  const normalized = (): string => sql.replace(/\s+/g, ' ');
  /** The file with its `--` comments removed, so prose cannot trip a check. */
  const code = (): string => sql.replace(/--[^\n]*/g, '');

  it('★ replaces the CHECK with the four functions the business named, or NULL', () => {
    expect(normalized()).toContain('ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_function');
    expect(normalized()).toContain(
      "ADD CONSTRAINT departments_function CHECK (function IS NULL OR function IN ('sales', 'accounting', 'dispatch', 'customer_service'))",
    );
  });

  it('★ leaves 0032 exactly as it ran — the old CHECK still names three', () => {
    expect(previous.replace(/\s+/g, ' ')).toContain(
      "CHECK (function IS NULL OR function IN ('sales', 'accounting', 'dispatch'))",
    );
    expect(previous).not.toContain('customer_service');
  });

  it('bounds how long it will wait for the ACCESS EXCLUSIVE lock — the 0027 pattern', () => {
    expect(code()).toMatch(/SET LOCAL lock_timeout = '5s';/);
  });

  it('adds no column, no table and no index — the column is 0032’s', () => {
    expect(code()).not.toMatch(/ADD COLUMN/i);
    expect(code()).not.toMatch(/CREATE TABLE/i);
    expect(code()).not.toMatch(/CREATE (UNIQUE )?INDEX/i);
  });

  it('★ seeds nothing and names no department — which unit is which is data', () => {
    expect(code().toUpperCase()).not.toContain('INSERT INTO');
    expect(code()).not.toMatch(/UPDATE\s+departments/i);
    expect(code()).not.toMatch(/WHERE\s+slug/i);
  });
});
