import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Asserts the SHAPE of 0035 without a database — what it adds, and as much
 * what it leaves alone: no trip status, no seeded request, no rule about how
 * many lorries one driver runs. The behaviour is proven against a server in
 * `tests/integration/driver-open-booking.integration.spec.ts`.
 */
describe('0035_trip_assignment_requests.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0035_trip_assignment_requests.sql'), 'utf8');
  });

  /** The file without `--` comments, whitespace collapsed, so prose cannot trip a check. */
  const code = (): string => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

  it('★ keeps a request apart from an assignment, with its five states', () => {
    expect(code()).toContain('CREATE TABLE IF NOT EXISTS trip_assignment_requests');
    expect(code()).toContain("CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn', 'superseded'))");
    expect(code()).not.toMatch(/INSERT INTO trip_driver_assignments/i);
  });

  it('★ one pending ask per driver per trip — a partial unique index, not a rule on turns', () => {
    expect(code()).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_assignment_request_pending ON trip_assignment_requests (trip_id, driver_user_id) WHERE state = 'pending'",
    );
  });

  it('★ an approval names the turn made from it: same trip, same driver', () => {
    expect(code()).toContain("CHECK ((state = 'approved') = (approved_assignment_id IS NOT NULL))");
    expect(code()).toContain(
      'FOREIGN KEY (approved_assignment_id, trip_id, driver_user_id) REFERENCES trip_driver_assignments (id, trip_id, driver_user_id)',
    );
    expect(code()).toContain('ADD CONSTRAINT trip_driver_assignments_id_trip_driver UNIQUE (id, trip_id, driver_user_id)');
  });

  it('supersedes with a fixed word, and lets a rejection say why — never whitespace', () => {
    expect(code()).toContain("resolution_reason IN ('trip_assigned', 'trip_closed', 'trip_archived')");
    expect(code()).toContain("WHEN 'rejected' THEN resolution_reason IS NULL OR length(trim(resolution_reason)) > 0");
  });

  it('★ keeps history: a decided request is final, and nothing is deleted', () => {
    expect(code()).toContain("IF OLD.state <> 'pending'");
    expect(code()).toContain('BEFORE DELETE ON trip_assignment_requests FOR EACH ROW EXECUTE FUNCTION deny_delete()');
  });

  it('adds no trip status and seeds nothing', () => {
    expect(code()).not.toMatch(/trip_schedules[^;]*status/i);
    expect(code()).not.toMatch(/INSERT INTO/i);
  });

  it('teaches notifications the two outcomes that are not already an assignment', () => {
    expect(code()).toContain("'ASSIGNMENT_REQUEST_REJECTED'");
    expect(code()).toContain("'ASSIGNMENT_REQUEST_SUPERSEDED'");
    expect(code()).not.toContain("'ASSIGNMENT_REQUEST_APPROVED'");
  });
});
