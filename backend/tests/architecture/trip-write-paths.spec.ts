import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A source audit of every way a trip's operational state can be written.
 *
 * ★ WHY THIS IS A TEST AND NOT A CODE REVIEW.
 *
 * Every rule below is one that holds today by ARRANGEMENT rather than by
 * construction: `finished` has one write path because two services happen to be
 * written the way they are, and a status change records history because three
 * call sites happen to remember to. Both survive exactly as long as nobody adds
 * a fourth call site — and neither the type checker nor any unit test would
 * notice if somebody did.
 *
 * This is the same job `scripts/check-boundaries.sh` does for module
 * dependencies, applied to the invariants that would be unrecoverable if broken:
 * a trip closed with no approval cannot be reopened, and a status change with no
 * history cannot be reconstructed.
 *
 * ⚠ IT READS SOURCE TEXT, so it is defeated by anybody determined to defeat it.
 * It is here to catch the accident, not the adversary.
 */
const CAPABILITY = join(__dirname, '..', '..', 'src', 'capabilities', 'trip-schedule');

const read = (...segments: string[]): Promise<string> =>
  readFile(join(CAPABILITY, ...segments), 'utf8');

/** Source with `//` and `/* *\/` comments removed. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const listFiles = async (folder: string): Promise<string[]> => {
  const entries = await readdir(join(CAPABILITY, folder));
  return entries.filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'));
};

describe('trip_schedules.status — the write paths', () => {
  it('is written by exactly two statements, both in the repository', async () => {
    // `replace` (the general edit) and `updateStatus` (the board move). A third
    // would be a path nothing in this file knows to check.
    const repository = code(await read('persistence', 'trip-schedule.repository.ts'));
    const writes = repository.match(/SET[\s\S]{0,400}?status = \$/g) ?? [];

    expect(writes).toHaveLength(2);
  });

  it('is never written outside the persistence layer', async () => {
    for (const folder of ['api', 'application', 'domain']) {
      for (const file of await listFiles(folder)) {
        const body = code(await read(folder, file));
        expect([folder, file, /UPDATE\s+trip_schedules/i.test(body)]).toEqual([folder, file, false]);
      }
    }
  });

  it('★ reaches `finished` from exactly one place: the canonical closure', async () => {
    // The single most important assertion here. 0025 makes `finished` terminal,
    // so a second way in is a way to close a trip permanently while skipping the
    // closing stamp and the history. "Đã xác nhận" — approval, the SuperAdmin's
    // manual completion, the legacy normalization — all go through `closeTrip`.
    const offenders: string[] = [];

    for (const folder of ['api', 'application']) {
      for (const file of await listFiles(folder)) {
        const body = code(await read(folder, file));
        if (/updateStatus\([^)]*'finished'/.test(body)) offenders.push(`${folder}/${file}`);
      }
    }

    expect(offenders).toEqual(['application/trip-closure.ts']);
  });

  it('★ closes a trip from exactly three doors, and names each one in the history', async () => {
    const callers: string[] = [];
    for (const folder of ['api', 'application', 'cli']) {
      for (const file of await listFiles(folder)) {
        if (/\bcloseTrip\(/.test(code(await read(folder, file))) && file !== 'trip-closure.ts') {
          callers.push(`${folder}/${file}`);
        }
      }
    }
    expect(callers).toEqual(['application/legacy-confirmed-normalization.ts', 'application/trip-completion.service.ts']);

    const completion = code(await read('application', 'trip-completion.service.ts'));
    const legacy = code(await read('application', 'legacy-confirmed-normalization.ts'));
    expect(completion).toContain('reason: COMPLETION_APPROVED_REASON');
    expect(completion).toContain('reason: MANUAL_COMPLETION_REASON');
    expect(legacy).toContain('reason: LEGACY_NORMALIZATION_REASON');
    // ★ AND FABRICATES NOTHING: the normalization writes no event, request,
    // approval or notification, and ends no turn.
    expect(legacy).not.toMatch(/recordEvent|requests\.|decide\(|notification|\.end\(|assign\(/i);
  });

  it('★ gives the office no way to move the lifecycle — and no way to `finished`', async () => {
    // The edit runs through `requireUnchangedStatus` (one rule, one call): a
    // status in the body must equal the one stored. Creation resolves
    // its start through `initialLifecycle`, which refuses `finished` and opens
    // every booking `pending`. And there is no status route at all — the
    // driver's first milestone and approval are the only movers.
    const service = code(await read('application', 'trip-schedule.service.ts'));
    const lifecycle = code(await read('domain', 'trip-status-history.ts'));
    const controller = code(await read('api', 'trip-schedule.controller.ts'));

    expect(service).toContain('const requireUnchangedStatus = (');
    expect(service.match(/requireUnchangedStatus\(/g)).toHaveLength(1);
    expect(service).not.toMatch(/async updateStatus\(/);
    expect(service).not.toMatch(/this\.trips\.updateStatus\(/);
    expect(service).toContain('isCompletionOnlyStatus');
    expect(service).toContain('initialLifecycle(');
    expect(lifecycle).toContain("if (isCompletionOnlyStatus(status)) return { ok: false, refusal: 'COMPLETION_ONLY' };");
    expect(lifecycle).toContain("if (status !== 'pending') return { ok: false, refusal: 'STATUS_SET_BY_SERVER' };");
    expect(controller).not.toMatch(/trip-schedules\/:tripId\/status'/);
  });

  it('has no second implementation of closing a trip', async () => {
    // `markClosed` writes `closed_at`/`closed_by`. Closing a trip that RAN on
    // the board belongs to approval, and a copy of it elsewhere is an answer
    // waiting to drift from the first.
    const callers: string[] = [];

    for (const folder of ['api', 'application']) {
      for (const file of await listFiles(folder)) {
        if (/markClosed\(/.test(code(await read(folder, file)))) callers.push(`${folder}/${file}`);
      }
    }

    expect(callers).toEqual(['application/trip-closure.ts']);
  });

  it('★ is BORN finished by exactly one statement, and only for a run recorded after it ended', async () => {
    // The second way into `finished`, sanctioned and single: the create
    // intent `historical`. It creates the row finished and stamped in one
    // statement — it never MOVES a trip there, so the approval rule above stays
    // whole. The client names the intent; only `initialLifecycle` turns that
    // into `closed`, and only for `historical`.
    const callers: string[] = [];
    for (const folder of ['api', 'application']) {
      for (const file of await listFiles(folder)) {
        if (/createFinished\(/.test(code(await read(folder, file)))) callers.push(`${folder}/${file}`);
      }
    }
    expect(callers).toEqual(['application/trip-schedule.service.ts']);

    const service = code(await read('application', 'trip-schedule.service.ts'));
    expect(service).toContain('start.closed');
    const lifecycle = code(await read('domain', 'trip-status-history.ts'));
    // The value, not the type: one place writes `closed: true,`.
    expect(lifecycle.match(/closed: true,/g)).toHaveLength(1);
    expect(lifecycle).toMatch(/mode === 'historical'[\s\S]{0,200}closed: true,/);
  });

  it('★ writes a recorded crew as history — never an ACTIVE turn, never an invented execution', async () => {
    const crew = code(await read('application', 'trip-entry-crew.ts'));

    expect(crew.match(/this\.assignments\.assign\(/g)).toHaveLength(1);
    expect(crew.match(/this\.assignments\.end\(/g)).toHaveLength(1);
    expect(crew).not.toMatch(/updateStatus\(|markClosed\(|completion|recordEvent|notification/i);
  });
});

describe('trip_status_history — no bypass', () => {
  it('is written only through the repository built for it', async () => {
    for (const folder of ['api', 'application', 'domain']) {
      for (const file of await listFiles(folder)) {
        const body = code(await read(folder, file));
        expect([folder, file, /INSERT\s+INTO\s+trip_status_history/i.test(body)]).toEqual([
          folder,
          file,
          false,
        ]);
      }
    }
  });

  it('is recorded by every service that moves a status, and only inside a transaction', async () => {
    // Three files write a status — creation, the driver's start, the closure;
    // all must record. `record` takes its
    // executor with NO DEFAULT, so a caller without a transaction in hand
    // cannot call it at all — the type checker holds that half. Closing records
    // through the canonical closure, in the same call that writes `finished`;
    // the driver's first milestone records `pending → executing` beside the event.
    const schedule = code(await read('application', 'trip-schedule.service.ts'));
    const closure = code(await read('application', 'trip-closure.ts'));
    const execution = code(await read('application', 'trip-execution.service.ts'));

    expect(schedule).toContain('this.history.record(');
    expect(closure).toContain('repositories.history.record(');
    expect(execution).toContain('this.history.record(');

    const historyRepository = code(await read('persistence', 'trip-status-history.repository.ts'));
    expect(historyRepository).toContain('executor: DatabaseQuery,');
    expect(historyRepository).not.toMatch(/record\([\s\S]{0,300}executor: DatabaseQuery = this\.db/);
  });

  it('★ lets the driver path move a trip ONE way only: pending → executing', async () => {
    // Execution is started by the driver's first milestone and by nothing in the
    // office; this service must never send a trip back, close it, or write any
    // other status.
    const execution = code(await read('application', 'trip-execution.service.ts'));
    const moves = execution.match(/this\.trips\.updateStatus\([^)]*\)/g) ?? [];

    expect(moves).toEqual(["this.trips.updateStatus(trip.id, 'executing', tx)"]);
  });

  it('offers no way to change or remove a recorded transition', async () => {
    const historyRepository = code(await read('persistence', 'trip-status-history.repository.ts'));

    expect(historyRepository).not.toMatch(/UPDATE\s+trip_status_history/i);
    expect(historyRepository).not.toMatch(/DELETE\s+FROM/i);
  });
});

describe('the money — no path around the lifecycle', () => {
  it('changes a figure through exactly one guarded statement', async () => {
    // `editEditable` carries `state = 'editable'` in its own WHERE clause. Any
    // other UPDATE touching amount, category or note would be a way around it.
    const repository = code(await read('persistence', 'trip-cost.repository.ts'));
    const edits = repository.match(/UPDATE trip_costs\s+SET category = \$/g) ?? [];

    expect(edits).toHaveLength(1);
    expect(repository).toContain("WHERE id = $1 AND state = 'editable' AND voided_at IS NULL");
  });

  it('never issues a DELETE against any trip table', async () => {
    for (const folder of ['api', 'application', 'domain', 'persistence']) {
      for (const file of await listFiles(folder)) {
        const body = code(await read(folder, file));
        expect([folder, file, /DELETE\s+FROM/i.test(body)]).toEqual([folder, file, false]);
      }
    }
  });

  it('moves lifecycle state only through the three named transitions', async () => {
    const repository = code(await read('persistence', 'trip-cost.repository.ts'));
    const transitions = repository.match(/SET\s+state = '(\w+)'/g) ?? [];

    // lockForAssignment → locked, unlockForAssignment → editable,
    // finalizeForAssignment → immutable.
    expect(transitions.sort()).toEqual([
      "SET state = 'editable'",
      "SET state = 'immutable'",
      "SET state = 'locked'",
    ]);
  });

  it('★ scopes every lifecycle move to the assignment, never to the whole trip', async () => {
    // ADR-0004: driver A asking for their turn to be closed must not freeze,
    // reopen or finalise what driver B typed on another lorry of the same trip.
    // Each of the three UPDATEs names `driver_assignment_id`, and none of them
    // names `trip_id` as the scope.
    const repository = code(await read('persistence', 'trip-cost.repository.ts'));
    const moves = repository.match(/UPDATE trip_costs\s+SET state = '\w+'[\s\S]{0,200}?WHERE[^\n]*/g) ?? [];

    expect(moves).toHaveLength(3);
    for (const move of moves) {
      expect(move).toContain('WHERE driver_assignment_id = $1');
      expect(move).not.toMatch(/WHERE trip_id/);
    }
    expect(repository).not.toMatch(/(lock|unlock|finalize)ForTrip\(/);
  });

  it('never writes `immutable` outside approval', async () => {
    const callers: string[] = [];

    for (const folder of ['api', 'application']) {
      for (const file of await listFiles(folder)) {
        if (/finalizeFor\w+\(/.test(code(await read(folder, file)))) {
          callers.push(`${folder}/${file}`);
        }
      }
    }

    expect(callers).toEqual(['application/trip-completion.service.ts']);
  });
});

describe('★ a lorry’s fuel — counted once (0034)', () => {
  it('never reaches a trip total: the board, the export and cost-summary read no vehicle cost', async () => {
    // The morning fill belongs to the lorry. A trip total that read
    // `vehicle_costs` would charge it to one run — and count it beside any
    // `fuel` line the trip already carries.
    for (const file of ['trip-board-cost.repository.ts', 'trip-cost.repository.ts']) {
      const body = code(await read('persistence', file));
      expect([file, /vehicle_costs|vehicle_daily_fuel_checks/.test(body)]).toEqual([file, false]);
    }
  });

  it('★ writes a lorry’s fuel from one service, and never into trip_costs', async () => {
    const writers: string[] = [];
    for (const folder of ['api', 'application', 'persistence']) {
      for (const file of await listFiles(folder)) {
        if (/INSERT INTO vehicle_costs|INSERT INTO vehicle_daily_fuel_checks/.test(code(await read(folder, file)))) {
          writers.push(`${folder}/${file}`);
        }
      }
    }
    expect(writers.sort()).toEqual([
      'persistence/vehicle-cost.repository.ts',
      'persistence/vehicle-fuel-check.repository.ts',
    ]);
    expect(code(await read('application', 'vehicle-fuel.service.ts'))).not.toMatch(/trip_costs|TripCostRepository/);
  });
});

describe("★ the driver read model — what cannot leave", () => {
  it('never selects a wildcard', async () => {
    // `SELECT *` hands a driver every column the table has TODAY and every one
    // it gains later. That is how a `margin` added next year reaches a phone
    // with no test failing and nobody deciding it should.
    const repository = code(await read('persistence', 'driver-read-model.repository.ts'));

    expect(repository).not.toMatch(/SELECT\s+\*/i);
    expect(repository).not.toMatch(/t\.\*/);
  });

  it('never selects the free-text note', async () => {
    // The contract has never said who writes `note` or what belongs in it, so
    // it cannot be shown to somebody the contract protects.
    const repository = code(await read('persistence', 'driver-read-model.repository.ts'));

    expect(repository).not.toMatch(/t\.note/);
    expect(code(await read('domain', 'driver-read-model.ts'))).not.toMatch(/^\s*note:/m);
  });

  it('★ never joins a table that holds money', async () => {
    // This is what makes "a driver sees no money" true by CONSTRUCTION rather
    // than by filtering: there is no amount in the result set to leak.
    const repository = code(await read('persistence', 'driver-read-model.repository.ts'));

    for (const table of ['trip_costs', 'trip_outsource_hires', 'trip_carriers', 'vehicle_costs']) {
      expect([table, repository.includes(table)]).toEqual([table, false]);
    }
  });

  it('filters every query on the driver, even the ones a guard already covers', async () => {
    // A guard is a decorator somebody can forget to write; a WHERE clause is
    // not. Without the guard these queries return nothing, not somebody else's
    // trip.
    const repository = code(await read('persistence', 'driver-read-model.repository.ts'));
    const queries = repository.match(/FROM trip_driver_assignments/g) ?? [];
    const filters = repository.match(/a\.driver_user_id = \$/g) ?? [];

    expect(filters.length).toBeGreaterThanOrEqual(queries.length);
  });

  it('builds the projection field by field rather than spreading a row', async () => {
    const repository = code(await read('persistence', 'driver-read-model.repository.ts'));

    expect(repository).not.toMatch(/\.\.\.row/);
  });

  it('shows a driver only their own declared lines, and never a total', async () => {
    // A trip's total includes the price agreed with a hired carrier — exactly
    // the commercial figure a driver must never see.
    const costs = code(await read('persistence', 'trip-cost.repository.ts'));
    const service = code(await read('application', 'driver-portal.service.ts'));

    expect(costs).toContain("AND c.source = 'driver_portal'");
    expect(costs).toContain('AND c.created_by = $2');
    expect(service).toContain('listDeclaredByDriver');
    expect(service).not.toContain('forTrip');
    expect(service).not.toContain('listActiveByTrip');
  });
});

describe('★ driver write routes — resource scope', () => {
  it('guards every route that names an assignment — to ACT on an active turn, to READ one of its own, to write MONEY on its own', async () => {
    const controller = await read('api', 'driver-portal.controller.ts');
    const routes = [...controller.matchAll(/@(Get|Post|Patch)\('([^']*)'\)/g)];
    const guards = [...controller.matchAll(/@UseGuards\(([^)]*)\)/g)].map((m) => m[1]);

    expect(routes).toHaveLength(guards.length);

    const guardOf = (on: string): string => {
      if (on.includes('ActiveAssignmentGuard')) return 'active';
      if (on.includes('ReadableAssignmentGuard')) return 'readable';
      if (on.includes('ExpenseAssignmentGuard')) return 'expense';
      return 'none';
    };
    const expectedFor = (method: string, path: string): string => {
      // The lists name no `:assignmentId` — their scope IS the session user.
      if (!path.includes(':assignmentId')) return 'none';
      // ★ Only the one read of a turn may take the wider guard: reading a
      // finished turn never widens what may be ACTED on.
      if (method === 'Get') return 'readable';
      // ★ The money routes — and only they — also admit a turn recorded after
      // the run (`driverExpenseScope`). Reporting and completion stay active-only.
      return path.includes('/expenses') ? 'expense' : 'active';
    };

    routes.forEach((match, index) => {
      const [, method = '', path = ''] = match;
      expect([method, path, guardOf(guards[index] ?? '')]).toEqual([method, path, expectedFor(method, path)]);
    });
  });

  it('★ names no trip on any driver route — the assignment is the scope (ADR-0004)', async () => {
    // One driver may hold several turns on one trip, so a trip id cannot say
    // which lorry is being reported. A driver route that took one would be a
    // route that had to guess.
    const controller = await read('api', 'driver-portal.controller.ts');
    const routes = [...controller.matchAll(/@(Get|Post|Patch)\('([^']*)'\)/g)].map((m) => m[2]);

    expect(routes.length).toBeGreaterThan(0);
    for (const path of routes) expect([path, /:tripId|trips\//.test(path ?? '')]).toEqual([path, false]);
  });

  it('never grants a driver a department-scoped permission', async () => {
    // `trip.write` is `head-anywhere` and would reach every trip in the
    // company; `cost.*` is `global` and would hand over the cost base.
    const controller = code(await read('api', 'driver-portal.controller.ts'));

    expect(controller).not.toContain('@RequirePermission');
    expect(controller).not.toContain('PermissionGuard');
  });

  it('reads the assignment id from the route on every write, never from the body', async () => {
    const controller = code(await read('api', 'driver-portal.controller.ts'));
    const params = [...controller.matchAll(/@Param\('assignmentId', UuidParam\)/g)];

    // Five writes (event, expense, correction, fuel check, completion) plus the detail read.
    expect(params).toHaveLength(6);
    expect(controller).not.toMatch(/body\.(assignmentId|tripId)/);
  });

  it('takes the actor from the session on every write, never from the body', async () => {
    const controller = code(await read('api', 'driver-portal.controller.ts'));

    expect(controller).not.toMatch(/body\.(declaredBy|recordedBy|submittedBy|createdBy)/);
    expect(controller).toContain('@CurrentUser() actor: SessionUser');
  });

  it('applies the temporary-credential gate without PermissionGuard', async () => {
    // These routes never reach PermissionGuard, so the guard has to repeat the
    // gate itself or a half-provisioned account could report deliveries.
    const guard = code(await read('api', 'active-assignment.guard.ts'));

    // The gate lives in ONE shared step, `loadProvisionedContext`, so it cannot
    // drift between guards; this guard must call it, and it must still gate.
    expect(guard).toContain('loadProvisionedContext(');
    const shared = code(
      await readFile(
        join(CAPABILITY, '..', '..', 'core', 'authorization', 'api', 'permission.guard.ts'),
        'utf8',
      ),
    );
    const step = shared.slice(shared.indexOf('function loadProvisionedContext'));
    expect(step).toContain('mustChangeSecret');
    expect(step).toContain('PasswordChangeRequiredError');
  });

  it('has no global-administrator escape', async () => {
    // The contract says an execution event is raised by the driver and by
    // nobody on their behalf.
    const guard = code(await read('api', 'active-assignment.guard.ts'));

    expect(guard).not.toMatch(/authorization\.global/);
  });
});

describe('ownership and carrier — still unclassified', () => {
  it('never infers a vehicle ownership anywhere in the capability', async () => {
    // ★ The rule is that ownership is ASSERTED by a person, never derived. A
    // fallback such as `?? 'company'` would quietly reintroduce the inference
    // the migration refused to make.
    for (const folder of ['api', 'application', 'domain', 'persistence']) {
      for (const file of await listFiles(folder)) {
        const body = code(await read(folder, file));
        expect([folder, file, /\?\?\s*'company'/.test(body)]).toEqual([folder, file, false]);
        expect([folder, file, /\|\|\s*'company'/.test(body)]).toEqual([folder, file, false]);
      }
    }
  });

  it('passes an unclassified lorry through as null', async () => {
    for (const file of ['trip-execution.service.ts', 'trip-cost.service.ts']) {
      const body = code(await read('application', file));
      expect([file, body.includes('vehicle?.ownership ?? null')]).toEqual([file, true]);
    }
  });
});

describe('★ the legacy lorry column — no writer, no dispatch reader (ADR-0004)', () => {
  it('is never written by the application', async () => {
    // `trip_schedules.vehicle_id` stays for the rows that carry one; nothing
    // sets it. A write here would be a second source of dispatch truth.
    const repository = code(await read('persistence', 'trip-schedule.repository.ts'));

    expect(repository).not.toMatch(/INSERT INTO trip_schedules[\s\S]{0,400}?vehicle_id/);
    expect(repository).not.toMatch(/SET[\s\S]{0,600}?\bvehicle_id = \$/);
  });

  it('never decides a snapshot, an expense or an event from `trip.vehicleId`', async () => {
    // The execution and cost services snapshot the ASSIGNMENT's lorry. Reading
    // the trip's column would be right only while a trip had one lorry.
    for (const file of ['trip-execution.service.ts', 'trip-cost.service.ts', 'driver-portal.service.ts']) {
      const body = code(await read('application', file));
      expect([file, /trip\.vehicleId/.test(body)]).toEqual([file, false]);
    }
    const board = code(await read('persistence', 'operational-board.repository.ts'));
    const driver = code(await read('persistence', 'driver-read-model.repository.ts'));
    for (const [name, body] of [['operational-board', board], ['driver-read-model', driver]]) {
      expect([name, /t\.vehicle_id/.test(body ?? '')]).toEqual([name, false]);
    }
  });

  it('never constrains the same driver to one turn per trip', async () => {
    // The confirmed business case is one person on several lorries of one
    // trip. A unique index on (trip_id, driver_user_id) anywhere would refuse it.
    const migrations = join(__dirname, '..', '..', 'migrations');
    const files = (await readdir(migrations)).filter((name) => name.endsWith('.sql'));
    for (const file of files) {
      const sql = (await readFile(join(migrations, file), 'utf8')).replace(/--[^\n]*/g, '');
      expect([file, /UNIQUE[\s\S]{0,200}?\(\s*trip_id\s*,\s*driver_user_id\s*\)/i.test(sql)]).toEqual([file, false]);
    }
  });

  it('never matches a legacy carrier name to a catalogue row', async () => {
    // `trip_outsource_hires.carrier_name` stays as typed. Guessing which
    // carrier `xe Út` is points historical money at the wrong company.
    for (const folder of ['application', 'persistence']) {
      for (const file of await listFiles(folder)) {
        const body = code(await read(folder, file));
        expect([folder, file, /carrier_name\s*(?:=|LIKE|ILIKE)/i.test(body)]).toEqual([
          folder,
          file,
          false,
        ]);
      }
    }
  });
});
