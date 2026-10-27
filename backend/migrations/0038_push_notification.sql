-- 0038_push_notification.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- Nhắc tài xế TRƯỚC giờ khởi hành, kể cả khi không ai mở trình duyệt.
--
-- 0020 giữ thứ một tài xế được báo và đẩy qua WebSocket. Nhưng WebSocket chỉ
-- sống khi tab còn mở: một tài xế đóng máy lúc 8 giờ tối sẽ không biết chuyến
-- 10 giờ sáng hôm sau sắp chạy. Web Push đi qua hệ điều hành chứ không qua tab,
-- nên nó là cách duy nhất chạm tới người đã rời khỏi trang.
--
-- Hai bảng, hai câu hỏi tách bạch:
--
--   push_devices  — GỬI TỚI ĐÂU. Một tài xế, nhiều máy.
--   push_jobs     — GỬI CÁI GÌ, LÚC NÀO. Một lượt nhắc, một hàng.
--
-- ★ KHÔNG BẢNG NÀO CHỨA NỘI DUNG CÂU THÔNG BÁO. Câu chữ do worker dựng khi gửi,
-- từ chuyến đi đọc lại tại thời điểm đó — cùng lý lẽ 0020 nêu: một câu đã đóng
-- băng trong hàng sẽ nói sai khi giờ khởi hành đổi giữa lúc lập lịch và lúc gửi.
--
-- ★ KHÔNG XOÁ GÌ CẢ (B13). Thiết bị bị "revoked", job bị "cancelled". Role
-- runtime không hề có quyền DELETE, nên một câu DELETE ở đây sẽ không đỏ lúc
-- review mà đỏ trên production.

-- ---------------------------------------------------------------- devices ----

CREATE TABLE IF NOT EXISTS push_devices (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Chủ sở hữu. LUÔN lấy từ session ở tầng API, không bao giờ từ body.
  user_id     UUID        NOT NULL REFERENCES users(id),

  -- ★ DUY NHẤT TOÀN CỤC, VÀ ĐÓ LÀ MỘT LUẬT VỀ QUYỀN RIÊNG TƯ, KHÔNG PHẢI MỘT
  -- TỐI ƯU. FCM phát token theo (trình duyệt + service worker), nên hai tài xế
  -- dùng chung một máy — chuyện thường ở bãi xe — sẽ lần lượt nhận CÙNG một
  -- token. Nếu token được phép thuộc về hai hàng, lượt nhắc của người này sẽ
  -- nổ trên màn hình người kia. Unique ở đây buộc việc đăng ký phải CHUYỂN
  -- quyền sở hữu (ON CONFLICT … DO UPDATE SET user_id), chứ không nhân bản nó.
  fcm_token   TEXT        NOT NULL UNIQUE CHECK (length(trim(fcm_token)) > 0),

  -- Chẩn đoán, để người vận hành biết "máy nào" khi tài xế gọi điện hỏi. Không
  -- có luật nào đọc cột này.
  user_agent  TEXT,

  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'revoked')),

  -- Lần cuối token này được tài xế xác nhận lại (mỗi lần mở trang bật thông báo).
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Câu đọc duy nhất của worker: các máy đang sống của MỘT tài xế.
CREATE INDEX IF NOT EXISTS idx_push_device_owner
  ON push_devices (user_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS push_devices_set_updated_at ON push_devices;
CREATE TRIGGER push_devices_set_updated_at
  BEFORE UPDATE ON push_devices
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS push_devices_deny_delete ON push_devices;
CREATE TRIGGER push_devices_deny_delete
  BEFORE DELETE ON push_devices
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

-- ------------------------------------------------------------------- jobs ----

CREATE TABLE IF NOT EXISTS push_jobs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  trip_id           UUID        NOT NULL REFERENCES trip_schedules(id),
  -- ★ LƯỢT NHẮC THUỘC VỀ MỘT ASSIGNMENT, KHÔNG PHẢI MỘT CHUYẾN. Đổi tài xế là
  -- kết thúc một assignment và mở một assignment khác (ADR-0004) — hai id khác
  -- nhau, nên job của người cũ không thể nào trở thành job của người mới.
  assignment_id     UUID        NOT NULL REFERENCES trip_driver_assignments(id),
  -- Chép ra đây để worker không phải tin vào một join lúc gửi, và để truy được
  -- "hàng này định gọi ai" kể cả sau khi assignment đã kết thúc.
  recipient_user_id UUID        NOT NULL REFERENCES users(id),

  -- Loại lượt nhắc. Hôm nay chỉ có một; cột tồn tại để lượt nhắc thứ hai
  -- (ví dụ "trễ giờ lấy hàng") không phải sửa unique index bên dưới.
  kind              TEXT        NOT NULL DEFAULT 'departure_reminder'
                                CHECK (kind IN ('departure_reminder')),

  -- Khi nào đến hạn gửi: pickup_at − 1 giờ, tính bằng UTC như mọi instant khác.
  run_at            TIMESTAMPTZ NOT NULL,
  -- ★ ẢNH CHỤP GIỜ KHỞI HÀNH LÚC LẬP LỊCH. Worker so lại với giờ hiện tại của
  -- chuyến ngay trước khi gửi: lệch nghĩa là ai đó đã dời giờ mà job này chưa
  -- được đồng bộ, và một lượt nhắc sai giờ còn tệ hơn không nhắc.
  pickup_at         TIMESTAMPTZ NOT NULL,

  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'processing', 'sent',
                                                  'cancelled', 'failed')),

  attempts          INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Sớm nhất được thử lại. NULL = không chờ gì cả.
  next_attempt_at   TIMESTAMPTZ,

  -- Ai đang cầm hàng này, từ lúc nào. Dùng để cứu job kẹt khi một worker chết
  -- giữa chừng — xem `recoverStuck`.
  locked_at         TIMESTAMPTZ,
  locked_by         TEXT,

  sent_at           TIMESTAMPTZ,
  -- Lỗi gần nhất, đã cắt ngắn. Không bao giờ chứa token.
  last_error        TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Một hàng đã gửi phải có mốc gửi; một hàng chưa gửi thì không.
  CONSTRAINT ck_push_job_sent_at
    CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

-- ★ MỘT LƯỢT NHẮC ĐANG SỐNG TRÊN MỘT ASSIGNMENT, VÀ CHỈ MỘT. Đây là thứ chặn
-- job trùng khi hai dispatcher bấm cùng lúc, khi một request được gửi lại, hay
-- khi cùng một thay đổi được đồng bộ hai lần. Index PARTIAL, nên lịch sử vẫn
-- giữ được mọi lượt đã gửi / đã huỷ của cùng assignment đó.
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_job_live
  ON push_jobs (assignment_id, kind) WHERE status IN ('pending', 'processing');

-- Câu quét của worker: hàng nào đến hạn.
CREATE INDEX IF NOT EXISTS idx_push_job_due
  ON push_jobs (run_at) WHERE status = 'pending';

-- Huỷ theo chuyến (archive) và theo assignment (đổi / kết thúc tài xế).
CREATE INDEX IF NOT EXISTS idx_push_job_trip
  ON push_jobs (trip_id) WHERE status IN ('pending', 'processing');

DROP TRIGGER IF EXISTS push_jobs_set_updated_at ON push_jobs;
CREATE TRIGGER push_jobs_set_updated_at
  BEFORE UPDATE ON push_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS push_jobs_deny_delete ON push_jobs;
CREATE TRIGGER push_jobs_deny_delete
  BEFORE DELETE ON push_jobs
  FOR EACH ROW EXECUTE FUNCTION deny_delete();
