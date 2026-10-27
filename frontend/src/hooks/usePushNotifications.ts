import { useCallback, useEffect, useState } from 'react';
import { registerPushDevice, unregisterPushDevice } from '@/api/notifications';
import {
  currentPushToken,
  deletePushToken,
  isPushSupported,
  onPushMessage,
  pushConfig,
  requestPushToken,
} from '@/utils/push';

/**
 * Trạng thái thông báo đẩy trên CHIẾC MÁY NÀY.
 *
 * ★ "BẬT" LÀ MỘT SỰ THẬT CỦA THIẾT BỊ, KHÔNG PHẢI CỦA TÀI KHOẢN. Cùng một tài
 * xế trên điện thoại và trên máy tính có hai câu trả lời khác nhau, và cả hai
 * đều đúng. Vì vậy trạng thái được đọc từ quyền của trình duyệt cộng với việc
 * có token hay không, chứ không từ một cờ nào trên máy chủ: một bản ghi
 * `push_devices` còn sót sau khi người ta xoá dữ liệu site sẽ nói dối.
 */
export type PushState =
  /** Chưa biết — đang kiểm tra trình duyệt. */
  | 'checking'
  /** Trình duyệt không làm được, và người dùng không sửa được bằng cách bấm lại. */
  | 'unsupported'
  /** Bản build này thiếu cấu hình Firebase. Lỗi của deployment, không phải của người dùng. */
  | 'unconfigured'
  /** Quyền đã bị chặn: chỉ cài đặt trình duyệt mới mở lại được. */
  | 'denied'
  | 'off'
  | 'on';

export interface PushControls {
  state: PushState;
  busy: boolean;
  /** Lý do kỹ thuật của lần thử gần nhất, nếu có. Để hiển thị kèm, không để thay câu tiếng Việt. */
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

/**
 * Bật/tắt thông báo đẩy, và biết hiện đang ở trạng thái nào.
 *
 * ★ KHÔNG XIN QUYỀN KHI MOUNT. Lúc tải trang hook chỉ ĐỌC: trình duyệt có hỗ
 * trợ không, quyền đang ở mức nào, đã có token chưa. Hộp thoại quyền chỉ bật
 * trong `enable`, tức là ngay sau một cú bấm — một hộp thoại không ai yêu cầu
 * gần như luôn bị bấm "Chặn", và chặn rồi thì không xin lại được từ trong trang.
 */
export function usePushNotifications(): PushControls {
  const [state, setState] = useState<PushState>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      if (!(await isPushSupported())) {
        if (alive) setState('unsupported');
        return;
      }
      if (!pushConfig()) {
        if (alive) setState('unconfigured');
        return;
      }
      if (Notification.permission === 'denied') {
        if (alive) setState('denied');
        return;
      }
      const token = await currentPushToken();
      if (alive) setState(token ? 'on' : 'off');
    })();

    return () => {
      alive = false;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestPushToken();
      if (result.status !== 'ok') {
        setState(result.status === 'failed' ? 'off' : result.status);
        setError(result.status === 'failed' ? result.reason : null);
        return;
      }
      // ★ TOKEN ĐƯỢC GỬI LÊN MỖI LẦN BẬT, KỂ CẢ KHI NÓ KHÔNG ĐỔI. Máy chủ
      // upsert, nên lời gọi thừa là vô hại — còn việc bỏ qua nó sẽ để một
      // token bị thu hồi (sau khi tài xế từng tắt) nằm im mãi mãi.
      await registerPushDevice(result.token);
      setState('on');
    } catch (cause) {
      setState('off');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await currentPushToken();
      // ★ BÁO MÁY CHỦ TRƯỚC, XOÁ TOKEN SAU. Thứ tự ngược lại sẽ để lại một
      // hàng `active` trỏ tới một token không còn ai cầm: máy chủ vẫn gửi,
      // FCM vẫn nhận, và không ai thấy gì cả.
      if (token) await unregisterPushDevice(token);
      await deletePushToken();
      setState('off');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, error, enable, disable };
}

/**
 * Thông điệp đẩy đến trong lúc tab đang mở.
 *
 * ★ KHÔNG DỰNG THÔNG BÁO HỆ THỐNG Ở ĐÂY. Service worker độc quyền việc đó;
 * trang đang mở chỉ nói một câu trong giao diện. Đó là cách chắc chắn nhất để
 * một sự kiện không hiện thành hai thông báo.
 */
export function usePushForegroundMessages(
  onMessage: (message: { title?: string; body?: string; link?: string }) => void,
): void {
  useEffect(() => onPushMessage(onMessage), [onMessage]);
}

/**
 * Gỡ thiết bị này trước khi phiên kết thúc.
 *
 * Tách khỏi hook để `useLogout` gọi được mà không cần render gì. Nuốt mọi lỗi:
 * không điều gì ở đây được phép giữ một người lại trong phiên họ muốn thoát.
 */
export async function releasePushDeviceOnLogout(): Promise<void> {
  try {
    const token = await currentPushToken();
    if (token) await unregisterPushDevice(token);
    await deletePushToken();
  } catch {
    // Đăng xuất vẫn tiếp tục. Token không được thu hồi sẽ chết tự nhiên khi
    // trình duyệt gỡ đăng ký, hoặc khi FCM báo nó không còn hiệu lực.
  }
}
