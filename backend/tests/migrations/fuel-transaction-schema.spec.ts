import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Asserts the SHAPE of 0037 without a database — and as much what it leaves
 * alone: no existing table is altered, no amount is stored, no global image
 * uniqueness. Behaviour against a server: `tests/integration/fuel-transaction.integration.spec.ts`.
 */
describe('0037_fuel_transaction_foundation.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0037_fuel_transaction_foundation.sql'), 'utf8');
  });

  /** The file without `--` comments, whitespace collapsed, so prose cannot trip a check. */
  const code = (): string => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

  it('creates exactly its four tables, idempotently', () => {
    const tables = [...code().matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1]);
    expect(tables.sort()).toEqual([
      'fuel_match_acks',
      'fuel_transaction_enrichments',
      'fuel_transaction_evidence',
      'fuel_transactions',
    ]);
    const creates = [...code().matchAll(/CREATE (UNIQUE )?(TABLE|INDEX)/g)].length;
    const guarded = [...code().matchAll(/CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS/g)].length;
    expect(guarded).toBe(creates);
  });

  it('★ alters nothing that exists, seeds nothing, stores no amount and no price per liter', () => {
    expect(code()).not.toMatch(/ALTER TABLE/i);
    expect(code()).not.toMatch(/INSERT INTO/i);
    expect(code()).not.toMatch(/UPDATE (vehicle_costs|trip_costs)/i);
    expect(code()).not.toMatch(/\bamount\b/);
    expect(code()).not.toMatch(/price/i);
  });

  it('★ backs every fill by exactly one money row, pinning a vehicle cost’s lorry and day', () => {
    expect(code()).toContain('CHECK ((vehicle_cost_id IS NULL) <> (trip_cost_id IS NULL))');
    expect(code()).toContain(
      'FOREIGN KEY (vehicle_cost_id, vehicle_id, business_date) REFERENCES vehicle_costs (id, vehicle_id, business_date)',
    );
    expect(code()).toContain('CHECK (vehicle_cost_id IS NULL OR (liters IS NULL AND odometer_km IS NULL))');
    expect(code()).toMatch(/uq_fuel_transaction_vehicle_cost ON fuel_transactions \(vehicle_cost_id\) WHERE vehicle_cost_id IS NOT NULL AND voided_at IS NULL/);
    expect(code()).toMatch(/uq_fuel_transaction_trip_cost ON fuel_transactions \(trip_cost_id\) WHERE trip_cost_id IS NOT NULL AND voided_at IS NULL/);
  });

  it('★ makes the same image on the same fill impossible — and leaves cross-fill reuse to a warning', () => {
    expect(code()).toMatch(
      /uq_fuel_evidence_on_transaction ON fuel_transaction_evidence \(fuel_transaction_id, sha256\) WHERE fuel_transaction_id IS NOT NULL AND retired_at IS NULL/,
    );
    expect(code()).not.toMatch(/UNIQUE INDEX IF NOT EXISTS \w+ ON fuel_transaction_evidence \(sha256\)/);
    expect(code()).toContain("CHECK (storage_key = 'fuel-evidence/' || sha256)");
  });

  it('★ keeps each fact and each trip reading append-only in the trigger — never rewritten, never cleared — and logs each once', () => {
    const fields = ['liters', 'odometer_km', 'occurred_at', 'driver_user_id', 'vendor_name', 'vendor_tax_code', 'document_series', 'document_number'];
    for (const field of fields) {
      expect(code()).toContain(`(OLD.${field} IS NOT NULL AND NEW.${field} IS DISTINCT FROM OLD.${field})`);
      expect(code()).toMatch(new RegExp(String.raw`field IN \([^)]*'${field}'`));
    }
    // Readings are no longer frozen at creation: only the identity is.
    expect(code()).toContain(
      'ROW(NEW.id, NEW.vehicle_id, NEW.business_date, NEW.vehicle_cost_id, NEW.trip_cost_id, NEW.created_by, NEW.created_at)',
    );
    expect(code()).toContain('ON fuel_transaction_enrichments (fuel_transaction_id, field)');
  });

  it('★ makes a void its own act — the voiding statement may change nothing else', () => {
    expect(code()).toMatch(
      /IF NEW\.voided_at IS NOT NULL AND ROW\(NEW\.liters, NEW\.odometer_km, NEW\.occurred_at, NEW\.driver_user_id, NEW\.vendor_name, NEW\.vendor_tax_code, NEW\.document_series, NEW\.document_number\) IS DISTINCT FROM/,
    );
  });

  it('★ never ties a lorry to a fixed driver — the driver rule reads the cost’s own provenance, not the lorry', () => {
    const start = code().indexOf('CREATE OR REPLACE FUNCTION fuel_transactions_validate()');
    const rule = code().slice(start, code().indexOf('$$ LANGUAGE plpgsql', start));
    expect(rule).toContain('backing.provenance_driver');
    expect(rule).not.toContain('trip_vehicles');
  });

  it('refuses a DELETE on all four tables and an UPDATE on both logs', () => {
    for (const table of ['fuel_transactions', 'fuel_transaction_enrichments', 'fuel_transaction_evidence', 'fuel_match_acks']) {
      expect(code()).toContain(`BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION deny_delete()`);
    }
    expect(code()).toContain('BEFORE UPDATE ON fuel_transaction_enrichments FOR EACH ROW EXECUTE FUNCTION fuel_append_only()');
    expect(code()).toContain('BEFORE UPDATE ON fuel_match_acks FOR EACH ROW EXECUTE FUNCTION fuel_append_only()');
  });

  it('bounds how long it will wait for a lock — the 0027 pattern', () => {
    expect(code()).toMatch(/SET LOCAL lock_timeout = '5s';/);
  });
});
