/**
 * Development fixture: one driver, and some trips they have already run.
 *
 *   npm run dev:seed-driver-history
 *
 * Gives a local deployment something to open the Driver Portal's "Đã chạy
 * xong" screen against — an account to sign in as, and enough finished trips
 * behind it to page through. Prints the username and password at the end;
 * nothing stores them.
 *
 * ★ DEVELOPMENT ONLY, AND IT SAYS SO ITSELF. It refuses to run when
 * `NODE_ENV=production` (read through `AppConfig`, the one validated door),
 * for the reason `seed-departments.cli.ts` gives: which rows are real is a
 * fact only an administrator knows, and inventing trips on a real database
 * would put work in a driver's history that nobody did.
 *
 * ★ A CLI RATHER THAN A MIGRATION. A trip is data, not schema, and a fixture
 * baked into a migration would ship to every deployment — which is the rule
 * `migrations/README.md` states as its third constraint.
 *
 * ★ THE ACCOUNT IS MADE THROUGH THE SERVICE, NOT BY INSERTING A ROW. Hashing,
 * the identity row and the username all belong to `provision`; a seed that
 * wrote `users` directly would produce an account that cannot log in, and
 * would be the first thing to break when provisioning changes.
 *
 * ⚠ THE TRIPS ARE INSERTED DIRECTLY, AND THAT IS DELIBERATE. Reaching
 * `finished` through the real path means a dispatcher creating a trip, crewing
 * it, a driver reporting four milestones with GPS inside a geofence, and
 * Operations approving the completion — per trip. This fixture is for looking
 * at a screen, so it writes the END STATE and says here that it skipped the
 * journey: there are no execution events and no completion requests behind
 * these rows, and the trip detail screen will show none.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { AppConfig } from '../../../config/app.config';
import { DATABASE, type Database } from '../../../common/types/database.port';
import { DriverAccountService } from '../../driver-account/application/driver-account.service';

/** The fixture driver. The domain is what `ALLOWED_EMAIL_DOMAINS` defaults to. */
const DRIVER = {
  displayName: 'Tài xế Lịch sử',
  email: 'taixe.lichsu@hoanglonglti.com',
  password: 'Taixe!LichSu2026',
};

/** How many finished trips to leave behind them — more than one page of 20. */
const TRIP_COUNT = 26;

const ROUTES = [
  ['Cảng Cát Lái, Phường Cát Lái', 'KCN Sóng Thần, Phường Dĩ An'],
  ['KCN VSIP 1, Phường Bình Hoà', 'ICD Phước Long, Phường Phước Long'],
  ['Kho Transimex, Phường Linh Trung', 'Cảng Cát Lái, Phường Cát Lái'],
  ['ICD Phước Long, Phường Phước Long', 'KCN Tân Bình, Phường Tây Thạnh'],
];

/** `YYYY-MM-DD`, `daysAgo` before today, in the business calendar's own terms. */
const dayBefore = (daysAgo: number): string => {
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  return day.toISOString().slice(0, 10);
};

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const config = app.get(AppConfig);
    if (config.isProduction) {
      console.error('Refusing to run: this is a development fixture, and NODE_ENV is production.');
      process.exitCode = 1;
      return;
    }

    const db = app.get<Database>(DATABASE);
    const drivers = app.get(DriverAccountService);

    // ---------------------------------------------------------- the driver --
    const existing = await db.query<{ id: string; display_name: string }>(
      `SELECT u.id, u.display_name
         FROM users u
         JOIN identities i ON i.user_id = u.id
        WHERE u.account_type = 'driver' AND i.subject = $1`,
      [DRIVER.email],
    );

    let driverId = existing[0]?.id ?? null;
    if (driverId) {
      console.log(`Driver already present — reusing ${DRIVER.email}`);
    } else {
      const created = await drivers.createDirectly({
        displayName: DRIVER.displayName,
        email: DRIVER.email,
        initialPassword: DRIVER.password,
      });
      driverId = created.userId;
      console.log(`Created driver ${created.displayName} (${created.username})`);
    }

    // ★ THE TEMPORARY-CREDENTIAL GATE IS LIFTED, BECAUSE IT IS NOT WHAT THIS
    // FIXTURE IS FOR. `ProvisionedAccountGuard` refuses every portal route
    // while a driver still holds the password somebody handed them — correct,
    // and it would mean signing in here only to be sent to a password form
    // before the screen under test could be opened.
    await db.query(`UPDATE identities SET must_change_secret = false WHERE user_id = $1`, [
      driverId,
    ]);

    // ------------------------------------------------- what the trips need --
    const [actor] = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE account_type = 'employee' ORDER BY created_at LIMIT 1`,
    );
    const vehicles = await db.query<{ id: string }>(`SELECT id FROM trip_vehicles LIMIT 3`);
    const customers = await db.query<{ id: string }>(`SELECT id FROM trip_customers LIMIT 4`);

    if (!actor || vehicles.length === 0 || customers.length === 0) {
      console.error(
        'Refusing to run: this fixture needs an employee, a vehicle and a customer to exist first.',
      );
      process.exitCode = 1;
      return;
    }

    // ★ IDEMPOTENT BY TOPPING UP, NOT BY DELETING AND REWRITING.
    //
    // The obvious version of this deleted the previous run's rows first. The
    // boundary check refuses that (`B13 runtime ↛ DELETE`) and is right to: a
    // trip is business history, the schema denies deleting the tables that
    // record it, and a fixture is not a reason to be the one piece of runtime
    // code that knows how. So an earlier run's trips are counted and left
    // alone, and only the shortfall is created.
    //
    // `cargo_info` carries the tag because it is the only free-text field on
    // the trip this fixture owns outright — nothing a person typed can be
    // mistaken for it.
    const TAG = '[dev-fixture: driver history]';
    const [already] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM trip_schedules t
         JOIN trip_driver_assignments a ON a.trip_id = t.id
        WHERE t.cargo_info = $1 AND a.driver_user_id = $2`,
      [TAG, driverId],
    );

    const have = already?.n ?? 0;
    if (have >= TRIP_COUNT) {
      console.log(`Already ${have} fixture trips for this driver — nothing to add.`);
      console.log(`  sign in with:  ${DRIVER.email}  /  ${DRIVER.password}`);
      console.log(`  then open:     /driver/history`);
      return;
    }
    if (have > 0) console.log(`Found ${have} fixture trips — topping up to ${TRIP_COUNT}.`);

    // ------------------------------------------------------------ the work --
    for (let i = have; i < TRIP_COUNT; i += 1) {
      const [pickup, delivery] = ROUTES[i % ROUTES.length] as [string, string];
      const day = dayBefore(i + 1);
      const customer = customers[i % customers.length]!.id;
      const vehicle = vehicles[i % vehicles.length]!.id;

      const [trip] = await db.query<{ id: string }>(
        `INSERT INTO trip_schedules
           (scheduled_on, created_by, customer_id, status,
            pickup_address, delivery_address, cargo_info,
            pickup_at, delivery_at, closed_at, closed_by)
         VALUES ($1, $2, $3, 'finished', $4, $5, $6,
                 ($1::date + time '07:00') AT TIME ZONE 'Asia/Ho_Chi_Minh',
                 ($1::date + time '15:00') AT TIME ZONE 'Asia/Ho_Chi_Minh',
                 ($1::date + time '16:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', $2)
         RETURNING id`,
        [day, actor.id, customer, pickup, delivery, TAG],
      );

      // ★ THE TURN STAYS `active`, WHICH IS NOT AN OVERSIGHT. A finished trip
      // keeps its assignments active (DL-97: the trip closes when every active
      // assignment has been approved), and the history query filters on the
      // TRIP's status for exactly that reason. Seeding `ended` here would
      // produce rows the real system never creates.
      await db.query(
        `INSERT INTO trip_driver_assignments
           (trip_id, driver_user_id, assigned_by, vehicle_id, assigned_at)
         VALUES ($1, $2, $3, $4, ($5::date + time '06:00') AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
        [trip!.id, driverId, actor.id, vehicle, day],
      );
    }

    console.log(`\nSeeded ${TRIP_COUNT - have} finished trips for ${DRIVER.email}`);
    console.log(`  sign in with:  ${DRIVER.email}  /  ${DRIVER.password}`);
    console.log(`  then open:     /driver/history`);
  } finally {
    await app.close();
  }
}

void main();
