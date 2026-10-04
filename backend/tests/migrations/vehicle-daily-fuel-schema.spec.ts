import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Asserts the SHAPE of 0034 without a database — what it adds, and as much
 * what it leaves alone: no lorry is gated by the deploy, and `trip_costs` is
 * not touched. The behaviour is proven against a server in
 * `tests/integration/vehicle-daily-fuel.integration.spec.ts`.
 */
describe('0034_vehicle_daily_fuel.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0034_vehicle_daily_fuel.sql'), 'utf8');
  });

  /** The file without `--` comments, whitespace collapsed, so prose cannot trip a check. */
  const code = (): string => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

  it('★ adds the policy OFF for every lorry, and never on for a hired one', () => {
    expect(code()).toContain('ADD COLUMN IF NOT EXISTS daily_fuel_check_required BOOLEAN NOT NULL DEFAULT false');
    expect(code()).toContain(
      "CHECK (NOT daily_fuel_check_required OR ownership IS DISTINCT FROM 'outsourced')",
    );
  });

  it('★ makes (vehicle, business day) the identity of the obligation', () => {
    expect(code()).toContain('PRIMARY KEY (vehicle_id, business_date)');
    expect(code()).toContain("CHECK (outcome IN ('fuel_added', 'no_fuel'))");
    expect(code()).toContain("CHECK ((outcome = 'fuel_added') = (vehicle_cost_id IS NOT NULL))");
  });

  it('defers the fill’s foreign key, so a check can name a fill written after it', () => {
    expect(code()).toMatch(
      /FOREIGN KEY \(vehicle_cost_id, vehicle_id, business_date\) REFERENCES vehicle_costs \(id, vehicle_id, business_date\) DEFERRABLE INITIALLY DEFERRED/,
    );
  });

  it('★ limits nothing per day on the ledger — fills stay 0..N', () => {
    expect(code()).not.toMatch(/UNIQUE[^;]*\(vehicle_id, business_date\)/);
    expect(code()).toContain('CREATE INDEX IF NOT EXISTS idx_vehicle_cost_vehicle_day ON vehicle_costs (vehicle_id, business_date)');
  });

  it('keeps provenance as provenance: the assignment pair, optional on the ledger', () => {
    expect(code()).toContain('CHECK ((source_trip_id IS NULL) = (source_assignment_id IS NULL))');
    expect(code()).toContain(
      'FOREIGN KEY (source_assignment_id, source_trip_id) REFERENCES trip_driver_assignments (id, trip_id)',
    );
  });

  it('★ touches no trip cost, rewrites no lorry, stores no price per liter', () => {
    expect(code()).not.toMatch(/trip_costs/);
    expect(code()).not.toMatch(/UPDATE\s+trip_vehicles/i);
    expect(code()).not.toMatch(/price_per_liter/);
    expect(code()).not.toMatch(/INSERT INTO/i);
  });

  it('refuses a whitespace void reason, as 0012 does for trip costs', () => {
    expect(code()).toContain('CHECK (void_reason IS NULL OR length(trim(void_reason)) > 0)');
  });

  it('refuses a DELETE on both tables, and any change to a check', () => {
    expect(code()).toContain('BEFORE DELETE ON vehicle_costs FOR EACH ROW EXECUTE FUNCTION deny_delete()');
    expect(code()).toContain('BEFORE UPDATE OR DELETE ON vehicle_daily_fuel_checks');
  });

  it('bounds how long it will wait for the ACCESS EXCLUSIVE lock — the 0027 pattern', () => {
    expect(code()).toMatch(/SET LOCAL lock_timeout = '5s';/);
  });
});
