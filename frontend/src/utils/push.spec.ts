import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ★ SDK ĐƯỢC THAY BẰNG MỘT BẢN GIẢ, VÀ CHỈ SDK. `isSupported()` của Firebase
 * trả về `false` trong jsdom dù có dựng `PushManager` hay không, nên để
 * nguyên thì mọi case dưới đây đều dừng ở "unsupported" và không chứng minh
 * được gì. Thứ các case này nói về là LUẬT của chúng ta — ba trạng thái từ
 * chối khác nhau — chứ không phải về việc Firebase chạy ra sao.
 */
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({ name: 'test' })) }));
vi.mock('firebase/messaging', () => ({
  isSupported: vi.fn(async () => true),
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(async () => 'a-token'),
  deleteToken: vi.fn(async () => true),
  onMessage: vi.fn(() => () => undefined),
}));

/**
 * Phần của Web Push không cần một trình duyệt thật.
 *
 * ★ ĐIỀU ĐÁNG KHẲNG ĐỊNH Ở ĐÂY LÀ NHỮNG LẦN NÓ TRẢ LỜI "KHÔNG". Một chiếc
 * iPhone chưa thêm trang vào màn hình chính, một quyền đã bị chặn, một bản
 * build thiếu cấu hình — cả ba phải ra ba câu trả lời KHÁC NHAU, vì ba cách
 * sửa là khác nhau. Gộp chúng thành "không bật được" là cách chắc chắn khiến
 * người ta bấm lại mãi mà không ai hiểu vì sao.
 */
describe('Web Push phía trình duyệt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Nạp lại module sau khi đã dựng xong môi trường — nó đọc env lúc gọi. */
  const load = () => import('./push');

  const stubBrowser = (over: { serviceWorker?: boolean; pushManager?: boolean } = {}) => {
    if (over.serviceWorker !== false) {
      vi.stubGlobal('navigator', { ...navigator, serviceWorker: { register: vi.fn() } });
    }
    if (over.pushManager !== false) vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
  };

  const stubConfig = (over: Record<string, string> = {}) => {
    const values: Record<string, string> = {
      VITE_FIREBASE_API_KEY: 'key',
      VITE_FIREBASE_AUTH_DOMAIN: 'web-push.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'web-push',
      VITE_FIREBASE_STORAGE_BUCKET: 'web-push.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
      VITE_FIREBASE_APP_ID: '1:123:web:abc',
      VITE_FIREBASE_VAPID_KEY: 'vapid',
      ...over,
    };
    for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  };

  describe('cấu hình', () => {
    it('đọc đủ bảy biến thì có cấu hình', async () => {
      stubConfig();
      const { pushConfig } = await load();

      expect(pushConfig()).toMatchObject({ projectId: 'web-push', vapidKey: 'vapid' });
    });

    it('★ thiếu VAPID key là CHƯA CẤU HÌNH, chứ không phải cấu hình một nửa', async () => {
      // Không có nó, `getToken` thất bại với một thông báo không nói lên điều
      // gì. Thà nói "chưa cấu hình" ngay còn hơn để người ta bấm vào một cái
      // nút không bao giờ chạy.
      stubConfig({ VITE_FIREBASE_VAPID_KEY: '' });
      const { pushConfig } = await load();

      expect(pushConfig()).toBeNull();
    });

    it('một bản build không khai báo gì cũng trả về null, không ném', async () => {
      const { pushConfig } = await load();
      expect(pushConfig()).toBeNull();
    });
  });

  describe('trình duyệt có hỗ trợ không', () => {
    it('★ thiếu PushManager là không hỗ trợ — đúng trường hợp Safari chưa thêm vào màn hình chính', async () => {
      stubBrowser({ pushManager: false });
      const { isPushSupported } = await load();

      expect(await isPushSupported()).toBe(false);
    });

    it('thiếu serviceWorker là không hỗ trợ', async () => {
      vi.stubGlobal('navigator', {});
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'default' });
      const { isPushSupported } = await load();

      expect(await isPushSupported()).toBe(false);
    });
  });

  describe('xin token', () => {
    it('★ trình duyệt không hỗ trợ thì không hề xin quyền', async () => {
      const requestPermission = vi.fn();
      vi.stubGlobal('navigator', {});
      vi.stubGlobal('Notification', { permission: 'default', requestPermission });
      stubConfig();
      const { requestPushToken } = await load();

      expect(await requestPushToken()).toEqual({ status: 'unsupported' });
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it('★ người dùng từ chối quyền thì trả về `denied`, không ném và không thử tiếp', async () => {
      stubBrowser();
      stubConfig();
      const requestPermission = vi.fn().mockResolvedValue('denied');
      vi.stubGlobal('Notification', { permission: 'default', requestPermission });
      const { requestPushToken } = await load();

      expect(await requestPushToken()).toEqual({ status: 'denied' });
    });

    it('★ đóng hộp thoại mà không chọn gì cũng là chưa được phép', async () => {
      // `default` nghĩa là người ta bỏ qua. Coi đó là thành công rồi đi tiếp
      // sẽ dẫn tới một lỗi khó hiểu sâu bên trong Firebase.
      stubBrowser();
      stubConfig();
      vi.stubGlobal('Notification', {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('default'),
      });
      const { requestPushToken } = await load();

      expect(await requestPushToken()).toEqual({ status: 'denied' });
    });

    it('bản build thiếu cấu hình nói rõ là chưa cấu hình', async () => {
      stubBrowser();
      const { requestPushToken } = await load();

      expect(await requestPushToken()).toEqual({ status: 'unconfigured' });
    });
  });
});
