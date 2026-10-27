import { Pool } from 'pg';
import type { Database } from '@common/types/database.port';
import { UserRepository } from '@core/users/persistence/user.repository';
import { PushDeviceRepository } from '../../src/capabilities/notification/persistence/push-device.repository';
import { PushJobRepository } from '../../src/capabilities/notification/persistence/push-job.repository';
import { PushSchedulerService } from '../../src/capabilities/notification/application/push-scheduler.service';
import {
  TEST_URL,
  applyAllMigrations,
  assertLooksLikeATestDatabase,
  describeIntegration,
  openTestSchema,
  poolAsDatabase,
} from '../helpers/integration-database';

/**
 * Hàng đợi lượt nhắc, đối mặt với một PostgreSQL thật.
 *
 * Những khẳng định ở đây KHÔNG thể kiểm chứng bằng mock, vì chúng là khẳng
 * định về chính database:
 *
 *   MỘT JOB, MỘT WORKER        hai worker quét cùng lúc chia nhau hàng đợi,
 *                              `FOR UPDATE SKIP LOCKED` lo phần đó
 *   KHÔNG JOB TRÙNG            `uq_push_job_live` chặn hàng thứ hai cho cùng
 *                              một lượt nhắc, kể cả khi hai transaction đua
 *   ĐÃ GỬI LÀ XONG             một hàng `sent` không bao giờ bị giành lại
 *   TOKEN ĐỔI CHỦ              một máy dùng chung không giữ lại chủ cũ
 */
const SCHEMA = 'push_job_itest';

describeIntegration('Hàng đợi Web Push đối mặt PostgreSQL thật', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let database: Database;
  let jobs: PushJobRepository;
  let devices: PushDeviceRepository;
  let scheduler: PushSchedulerService;
  let operator: string;
  let driverA: string;
  let driverB: string;

  /** 10:00 giờ Việt Nam; mốc nhắc là 02:00Z. */
  const PICKUP = new Date('2026-03-01T03:00:00.000Z');
  const DUE = new Date('2026-03-01T02:00:00.000Z');
  const BEFORE_DUE = new Date('2026-03-01T01:00:00.000Z');

  beforeAll(async () => {
    assertLooksLikeATestDatabase(TEST_URL as string);
    pool = await openTestSchema(TEST_URL as string, SCHEMA);
    await applyAllMigrations(pool);

    database = poolAsDatabase(pool);
    jobs = new PushJobRepository(database);
    devices = new PushDeviceRepository(database);
    scheduler = new PushSchedulerService(jobs);

    const users = new UserRepository(database);
    operator = (await users.insertUser({ displayName: 'Điều Độ' })).id;
    driverA = (await users.insertUser({ displayName: 'Tài Xế A', accountType: 'driver' })).id;
    driverB = (await users.insertUser({ displayName: 'Tài Xế B', accountType: 'driver' })).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // TRUNCATE chứ không DELETE: 0038 từ chối xoá hàng, đúng như 0017 đặt ra.
    await pool.query('TRUNCATE push_jobs, push_devices CASCADE');
    await pool.query('TRUNCATE trip_driver_assignments, trip_schedules CASCADE');
  });

  /** Một chuyến và một lượt phân công thật, vì job có khoá ngoại tới cả hai. */
  const dispatch = async (driver: string): Promise<{ trip: string; assignment: string }> => {
    const trip = (
      await pool.query<{ id: string }>(
        `INSERT INTO trip_schedules (scheduled_on, pickup_at, created_by)
         VALUES ($1::date, $2, $3) RETURNING id`,
        ['2026-03-01', PICKUP, operator],
      )
    ).rows[0]!.id;

    const vehicle = (
      await pool.query<{ id: string }>(
        `INSERT INTO trip_vehicles (plate, created_by) VALUES ($1, $2) RETURNING id`,
        [`51C-${Math.floor(10000 + Math.random() * 89999)}`, operator],
      )
    ).rows[0]!.id;

    const assignment = (
      await pool.query<{ id: string }>(
        `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [trip, vehicle, driver, operator],
      )
    ).rows[0]!.id;

    return { trip, assignment };
  };

  const schedule = async (driver: string): Promise<{ trip: string; assignment: string }> => {
    const refs = await dispatch(driver);
    await database.transaction((tx) =>
      scheduler.syncForAssignment(
        {
          tripId: refs.trip,
          assignmentId: refs.assignment,
          driverUserId: driver,
          pickupAt: PICKUP,
          tripStatus: 'pending',
        },
        tx,
        BEFORE_DUE,
      ),
    );
    return refs;
  };

  describe('giành job khi nhiều worker chạy cùng lúc', () => {
    it('★ mỗi job chỉ một worker lấy được', async () => {
      const refs = await Promise.all([
        schedule(driverA),
        schedule(driverB),
        schedule(driverA),
        schedule(driverB),
      ]);
      expect(refs).toHaveLength(4);

      // Bốn worker quét đúng một thời điểm, trên bốn kết nối khác nhau.
      const rounds = await Promise.all(
        ['w1', 'w2', 'w3', 'w4'].map((workerId) =>
          jobs.claimDue({ now: DUE, limit: 50, workerId }),
        ),
      );

      const claimed = rounds.flat().map((job) => job.id);
      // Không id nào xuất hiện hai lần: không hai worker nào cầm cùng một hàng.
      expect(new Set(claimed).size).toBe(claimed.length);
      expect(claimed).toHaveLength(4);
    });

    it('★ không giành hàng nào chưa tới hạn', async () => {
      await schedule(driverA);

      const early = await jobs.claimDue({ now: BEFORE_DUE, limit: 50, workerId: 'w1' });

      expect(early).toHaveLength(0);
    });

    it('★ một hàng đã gửi không bao giờ bị giành lại', async () => {
      await schedule(driverA);
      const [job] = await jobs.claimDue({ now: DUE, limit: 50, workerId: 'w1' });
      await jobs.markSent(job!.id, DUE);

      const again = await jobs.claimDue({ now: DUE, limit: 50, workerId: 'w2' });

      expect(again).toHaveLength(0);
      expect((await jobs.findById(job!.id))?.status).toBe('sent');
    });

    it('hàng chờ thử lại chỉ quay lại sau mốc đã hẹn', async () => {
      await schedule(driverA);
      const [job] = await jobs.claimDue({ now: DUE, limit: 50, workerId: 'w1' });
      const later = new Date(DUE.getTime() + 10 * 60 * 1000);
      await jobs.markRetry({ id: job!.id, nextAttemptAt: later, error: 'FCM bận' });

      expect(await jobs.claimDue({ now: DUE, limit: 50, workerId: 'w2' })).toHaveLength(0);
      expect(await jobs.claimDue({ now: later, limit: 50, workerId: 'w2' })).toHaveLength(1);
    });

    it('job bị kẹt được thả về sau khi worker cầm nó chết', async () => {
      await schedule(driverA);
      const [job] = await jobs.claimDue({ now: DUE, limit: 50, workerId: 'w1' });

      const released = await jobs.recoverStuck(new Date(Date.now() + 60_000));

      expect(released).toBe(1);
      expect((await jobs.findById(job!.id))?.status).toBe('pending');
    });
  });

  describe('không có job trùng cho cùng một lượt nhắc', () => {
    it('★ đồng bộ hai lần chỉ để lại một hàng đang sống', async () => {
      const refs = await schedule(driverA);

      // Lần đồng bộ thứ hai — đúng thứ xảy ra mỗi khi ai đó sửa chuyến.
      await database.transaction((tx) =>
        scheduler.syncForAssignment(
          {
            tripId: refs.trip,
            assignmentId: refs.assignment,
            driverUserId: driverA,
            pickupAt: new Date('2026-03-01T06:00:00.000Z'),
            tripStatus: 'pending',
          },
          tx,
          BEFORE_DUE,
        ),
      );

      const live = await pool.query(
        `SELECT run_at FROM push_jobs WHERE assignment_id = $1 AND status = 'pending'`,
        [refs.assignment],
      );
      expect(live.rows).toHaveLength(1);
      expect((live.rows[0] as { run_at: Date }).run_at.toISOString()).toBe(
        '2026-03-01T05:00:00.000Z',
      );
    });

    it('★ huỷ chuyến thì không còn hàng nào để giành', async () => {
      const refs = await schedule(driverA);

      await database.transaction((tx) => scheduler.cancelForTrip(refs.trip, tx));

      expect(await jobs.claimDue({ now: DUE, limit: 50, workerId: 'w1' })).toHaveLength(0);
      const cancelled = await pool.query(
        `SELECT status FROM push_jobs WHERE trip_id = $1`,
        [refs.trip],
      );
      expect((cancelled.rows[0] as { status: string }).status).toBe('cancelled');
    });

    it('★ đổi tài xế: hàng của người cũ chết, hàng của người mới mang đúng người nhận', async () => {
      const first = await schedule(driverA);

      // Lượt mới trên cùng chuyến — như `replaceDriver` vẫn làm: kết thúc một
      // hàng, mở một hàng khác, không bao giờ ghi đè `driver_user_id`.
      await pool.query(
        `UPDATE trip_driver_assignments
            SET state = 'ended', ended_at = now(), ended_by = $2, end_reason = $3
          WHERE id = $1`,
        [first.assignment, operator, 'đổi tài xế'],
      );
      const vehicle = (
        await pool.query<{ vehicle_id: string }>(
          `SELECT vehicle_id FROM trip_driver_assignments WHERE id = $1`,
          [first.assignment],
        )
      ).rows[0]!.vehicle_id;
      const second = (
        await pool.query<{ id: string }>(
          `INSERT INTO trip_driver_assignments (trip_id, vehicle_id, driver_user_id, assigned_by)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [first.trip, vehicle, driverB, operator],
        )
      ).rows[0]!.id;

      await database.transaction(async (tx) => {
        await scheduler.cancelForAssignment(first.assignment, tx);
        await scheduler.syncForAssignment(
          {
            tripId: first.trip,
            assignmentId: second,
            driverUserId: driverB,
            pickupAt: PICKUP,
            tripStatus: 'pending',
          },
          tx,
          BEFORE_DUE,
        );
      });

      const claimed = await jobs.claimDue({ now: DUE, limit: 50, workerId: 'w1' });

      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.recipientUserId).toBe(driverB);
      expect(claimed[0]!.assignmentId).toBe(second);
    });
  });

  describe('thiết bị', () => {
    it('★ một token chỉ thuộc về một người: máy dùng chung đổi chủ chứ không nhân bản', async () => {
      const TOKEN = 'token-của-máy-tính-bảng-ở-bãi-xe';

      await devices.upsert({ userId: driverA, fcmToken: TOKEN, userAgent: null, now: new Date() });
      await devices.upsert({ userId: driverB, fcmToken: TOKEN, userAgent: null, now: new Date() });

      // Nếu token được phép thuộc hai hàng, lượt nhắc của A sẽ nổ trước mặt B.
      expect(await devices.activeFor(driverA)).toHaveLength(0);
      expect(await devices.activeFor(driverB)).toHaveLength(1);
    });

    it('thu hồi chỉ chạm tới thiết bị của chính chủ', async () => {
      const TOKEN = 'token-riêng-của-A';
      await devices.upsert({ userId: driverA, fcmToken: TOKEN, userAgent: null, now: new Date() });

      expect(await devices.revoke(driverB, TOKEN)).toBeNull();
      expect(await devices.activeFor(driverA)).toHaveLength(1);

      expect(await devices.revoke(driverA, TOKEN)).not.toBeNull();
      expect(await devices.activeFor(driverA)).toHaveLength(0);
    });

    it('bật lại thông báo làm sống lại thiết bị đã thu hồi, không tạo hàng thứ hai', async () => {
      const TOKEN = 'token-bật-rồi-tắt-rồi-bật';
      await devices.upsert({ userId: driverA, fcmToken: TOKEN, userAgent: null, now: new Date() });
      await devices.revoke(driverA, TOKEN);
      await devices.upsert({ userId: driverA, fcmToken: TOKEN, userAgent: null, now: new Date() });

      const active = await devices.activeFor(driverA);
      expect(active).toHaveLength(1);

      const all = await pool.query(`SELECT count(*)::int AS n FROM push_devices`);
      expect((all.rows[0] as { n: number }).n).toBe(1);
    });
  });
});
