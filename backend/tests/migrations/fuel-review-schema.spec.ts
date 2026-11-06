import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Asserts the SHAPE of 0038 without a database — above all what it does NOT
 * copy: no amount, lorry, day, driver, liters, station or invoice lives in the
 * review table; the money stays on `vehicle_costs`, the facts on the fuel
 * transaction. Behaviour against a server: `driver-fuel-review.integration.spec.ts`.
 */
describe('0038_fuel_review.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0038_fuel_review.sql'), 'utf8');
  });

  const code = (): string => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

  it('creates exactly one table, idempotently, and alters only the evidence type CHECK', () => {
    expect([...code().matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1])).toEqual(['fuel_review_events']);
    expect([...code().matchAll(/ALTER TABLE (\w+)/g)].map((match) => match[1])).toEqual([
      'fuel_transaction_evidence',
      'fuel_transaction_evidence',
      'fuel_transaction_evidence',
    ]);
    expect(code()).not.toMatch(/ALTER TABLE (vehicle_costs|trip_costs|fuel_transactions)\b/);
  });

  it('★ copies no financial or fuel fact — only the step: who, which state, when, why', () => {
    const table = code().match(/CREATE TABLE IF NOT EXISTS fuel_review_events \((.*?)\);/)?.[1] ?? '';
    const columns = [...table.matchAll(/(?:^|, )\s*(\w+) (?:UUID|INTEGER|TEXT|TIMESTAMPTZ)/g)].map((match) => match[1]);
    expect(columns).toEqual(['id', 'fuel_transaction_id', 'seq', 'status', 'note', 'actor', 'at']);
    expect(table).not.toMatch(/amount|liters|vehicle_id|business_date|vendor|document|driver_user_id/);
  });

  it('★ keeps the history: no update, no delete, one step after another', () => {
    expect(code()).toMatch(/BEFORE UPDATE ON fuel_review_events FOR EACH ROW EXECUTE FUNCTION fuel_append_only\(\)/);
    expect(code()).toMatch(/BEFORE DELETE ON fuel_review_events FOR EACH ROW EXECUTE FUNCTION deny_delete\(\)/);
    expect(code()).toMatch(/UNIQUE \(fuel_transaction_id, seq\)/);
    expect(code()).toMatch(/prior\.status = 'approved' AND NEW\.status = 'paid'/);
  });

  it('takes the payment QR as one more image type — never anything to execute', () => {
    expect(code()).toMatch(/'tax_invoice', 'payment_qr'/);
    expect(code()).not.toMatch(/bank|account_number|credential/i);
  });
});
