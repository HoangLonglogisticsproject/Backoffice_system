import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A source audit of every way a trip's operational state can be written.
 *
 * ★ WHY THIS IS A TEST AND NOT A CODE REVIEW.
 *
 * Every rule below is one that holds today by ARRANGEMENT rather than by
 * construction: `done` has one write path because two services happen to be
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

  it('★ reaches `done` from exactly one place: the completion service', async () => {
    // The single most important assertion here. 0017 makes `done` terminal, so
    // a second way in is a way to close a trip permanently while skipping the
    // approval, the expense freeze and the closing stamp.
    const offenders: string[] = [];

    for (const folder of ['api', 'application']) {
      for (const file of await listFiles(folder)) {
        const body = code(await read(folder, file));
        if (/updateStatus\([^)]*'done'/.test(body)) offenders.push(`${folder}/${file}`);
      }
    }

    expect(offenders).toEqual(['application/trip-completion.service.ts']);
  });

  it('refuses `done` on every route the dispatch board offers', async () => {
    // Both ordinary paths run through `requireDispatchTransition`, and creation
    // runs through the same guard it delegates to — so a trip can neither be
    // moved to `done` nor born that way.
    const service = code(await read('application', 'trip-schedule.service.ts'));

    expect(service).toContain('this.requireNotCompletionOnly(values.status)');
    expect(service.match(/requireDispatchTransition\(/g)).toHaveLength(3);
    expect(service).toContain('isCompletionOnlyStatus');
  });

  it('has no second implementation of closing a trip', async () => {
    // `markClosed` writes `closed_at`/`closed_by`. Closing belongs to approval,
    // and a copy of it elsewhere is an answer waiting to drift from the first.
    const callers: string[] = [];

    for (const folder of ['api', 'application']) {
      for (const file of await listFiles(folder)) {
        if (/markClosed\(/.test(code(await read(folder, file)))) callers.push(`${folder}/${file}`);
      }
    }

    expect(callers).toEqual(['application/trip-completion.service.ts']);
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
    // Two files write the status; both must record. `record` takes its executor
    // with NO DEFAULT, so a caller without a transaction in hand cannot call it
    // at all — the type checker holds that half.
    const schedule = code(await read('application', 'trip-schedule.service.ts'));
    const completion = code(await read('application', 'trip-completion.service.ts'));

    expect(schedule).toContain('this.history.record(');
    expect(completion).toContain('this.history.record(');

    const historyRepository = code(await read('persistence', 'trip-status-history.repository.ts'));
    expect(historyRepository).toContain('executor: DatabaseQuery,');
    expect(historyRepository).not.toMatch(/record\([\s\S]{0,300}executor: DatabaseQuery = this\.db/);
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

    // lockForTrip → locked, unlockForTrip → editable, finalizeForTrip → immutable.
    expect(transitions.sort()).toEqual([
      "SET state = 'editable'",
      "SET state = 'immutable'",
      "SET state = 'locked'",
    ]);
  });

  it('never writes `immutable` outside approval', async () => {
    const callers: string[] = [];

    for (const folder of ['api', 'application']) {
      for (const file of await listFiles(folder)) {
        if (/finalizeForTrip\(/.test(code(await read(folder, file)))) {
          callers.push(`${folder}/${file}`);
        }
      }
    }

    expect(callers).toEqual(['application/trip-completion.service.ts']);
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

    for (const table of ['trip_costs', 'trip_outsource_hires', 'trip_carriers']) {
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
  it('guards every route that names a trip', async () => {
    const controller = await read('api', 'driver-portal.controller.ts');
    const routes = [...controller.matchAll(/@(Get|Post|Patch)\('([^']*)'\)/g)];
    const guards = [...controller.matchAll(/@UseGuards\(([^)]*)\)/g)].map((m) => m[1]);

    expect(routes).toHaveLength(guards.length);

    routes.forEach((match, index) => {
      // The one route without the guard is the list, which has no `:tripId` to
      // check — its scope IS the session user.
      const path = match[2] ?? '';
      const needsGuard = path.includes(':tripId');
      const guarded = (guards[index] ?? '').includes('ActiveAssignmentGuard');
      expect([path, guarded]).toEqual([path, needsGuard]);
    });
  });

  it('never grants a driver a department-scoped permission', async () => {
    // `trip.write` is `head-anywhere` and would reach every trip in the
    // company; `cost.*` is `global` and would hand over the cost base.
    const controller = code(await read('api', 'driver-portal.controller.ts'));

    expect(controller).not.toContain('@RequirePermission');
    expect(controller).not.toContain('PermissionGuard');
  });

  it('reads the trip id from the route on every write, never from the body', async () => {
    const controller = code(await read('api', 'driver-portal.controller.ts'));
    const params = [...controller.matchAll(/@Param\('tripId', UuidParam\)/g)];

    // Four writes plus the detail read.
    expect(params.length).toBe(5);
    expect(controller).not.toMatch(/body\.tripId/);
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

    expect(guard).toContain('mustChangeSecret');
    expect(guard).toContain('PasswordChangeRequiredError');
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
