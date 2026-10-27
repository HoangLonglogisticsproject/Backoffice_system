import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Khẳng định HÌNH DẠNG của 0038 mà không cần database — và khẳng định cả
 * những gì nó KHÔNG làm. Hành vi được chứng minh với một server thật trong
 * `tests/integration/push-job-claim.integration.spec.ts`.
 */
describe('0038_push_notification.sql', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(join(MIGRATIONS_DIR, '0038_push_notification.sql'), 'utf8');
  });

  /** File đã bỏ comment `--`, gộp khoảng trắng, để văn xuôi không làm sai một phép kiểm tra. */
  const code = (): string => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

  it('★ một token FCM chỉ thuộc về một người, nên không ai nhận lượt nhắc của người khác', () => {
    expect(code()).toContain('fcm_token TEXT NOT NULL UNIQUE');
    expect(code()).toContain('user_id UUID NOT NULL REFERENCES users(id)');
    expect(code()).toContain("CHECK (status IN ('active', 'revoked'))");
  });

  it('★ một lượt nhắc đang sống trên một lượt phân công, và chỉ một', () => {
    expect(code()).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_push_job_live ON push_jobs (assignment_id, kind) WHERE status IN ('pending', 'processing')",
    );
  });

  it('★ lượt nhắc thuộc về lượt phân công, không phải chuyến — nên đổi tài xế không lẫn người', () => {
    expect(code()).toContain(
      'assignment_id UUID NOT NULL REFERENCES trip_driver_assignments(id)',
    );
    expect(code()).toContain('recipient_user_id UUID NOT NULL REFERENCES users(id)');
  });

  it('mọi mốc thời gian là TIMESTAMPTZ, nên không có giờ nào mơ hồ về múi', () => {
    expect(code()).toContain('run_at TIMESTAMPTZ NOT NULL');
    expect(code()).toContain('pickup_at TIMESTAMPTZ NOT NULL');
    expect(code()).not.toMatch(/\b(run_at|pickup_at|sent_at|locked_at)\s+TIMESTAMP\b(?!TZ)/);
  });

  it('★ giữ đủ trạng thái để theo dõi một lượt nhắc từ đầu tới cuối', () => {
    expect(code()).toContain(
      "CHECK (status IN ('pending', 'processing', 'sent', 'cancelled', 'failed'))",
    );
    expect(code()).toContain('attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)');
    expect(code()).toContain('next_attempt_at TIMESTAMPTZ');
    expect(code()).toContain('last_error TEXT');
  });

  it('một hàng đã gửi phải có mốc gửi, và một hàng chưa gửi thì không', () => {
    expect(code()).toContain("CHECK ((status = 'sent') = (sent_at IS NOT NULL))");
  });

  it('có index cho câu quét của worker và cho hai đường huỷ', () => {
    expect(code()).toContain("ON push_jobs (run_at) WHERE status = 'pending'");
    expect(code()).toContain("ON push_jobs (trip_id) WHERE status IN ('pending', 'processing')");
    expect(code()).toContain("ON push_devices (user_id) WHERE status = 'active'");
  });

  it('★ không xoá gì cả: thiết bị bị thu hồi, job bị huỷ (B13)', () => {
    expect(code()).toContain('push_devices_deny_delete');
    expect(code()).toContain('push_jobs_deny_delete');
    expect(code()).not.toMatch(/DELETE\s+FROM/i);
  });

  it('idempotent, như mọi migration khác của dự án', () => {
    expect(code()).toContain('CREATE TABLE IF NOT EXISTS push_devices');
    expect(code()).toContain('CREATE TABLE IF NOT EXISTS push_jobs');
    expect(code()).not.toMatch(/INSERT INTO/i);
  });
});
