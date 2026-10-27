import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
} from 'firebase/messaging';

/**
 * Web Push phía trình duyệt: xin quyền, đăng ký service worker, lấy token.
 *
 * ★ MỌI THỨ Ở ĐÂY CÓ THỂ TRẢ LỜI "KHÔNG", VÀ KHÔNG CÁI NÀO ĐƯỢC PHÉP NÉM VÀO
 * MẶT NGƯỜI DÙNG. Một chiếc iPhone chưa thêm trang vào màn hình chính, một
 * trình duyệt đã bị chặn quyền, một deployment chưa cấu hình Firebase — cả ba
 * là chuyện bình thường, không phải sự cố. Nên hàm ở đây trả về một KẾT QUẢ có
 * tên gọi (`unsupported`, `denied`, `unconfigured`, `failed`) thay vì ném, để
 * màn hình nói được một câu cụ thể thay vì "đã xảy ra lỗi".
 *
 * ⚠ KHÔNG CÓ BẤT KỲ BÍ MẬT NÀO TRONG FILE NÀY. Firebase web config là công
 * khai theo thiết kế — nó định danh project, không cấp quyền. Service account
 * và private key nằm ở backend và không bao giờ đi qua đây.
 */

/** Đường dẫn service worker. Phải khớp với file trong `public/`. */
const SERVICE_WORKER_PATH = '/firebase-messaging-sw.js';

export interface PushConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

/**
 * Cấu hình từ biến môi trường của bản build.
 *
 * `null` khi thiếu bất kỳ mảnh nào — bao gồm cả VAPID key, thứ mà không có nó
 * `getToken` sẽ thất bại với một thông báo khó hiểu. Thà nói "chưa cấu hình"
 * ngay còn hơn để người dùng bấm vào một cái nút không bao giờ chạy.
 */
export const pushConfig = (): PushConfig | null => {
  const config: PushConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY ?? '',
  };
  return Object.values(config).every((value) => value !== '') ? config : null;
};

/**
 * Trình duyệt này có đủ thứ cần cho Web Push không.
 *
 * Ba điều kiện, và `isSupported()` của Firebase chưa đủ: Safari trên iOS chỉ
 * cấp `PushManager` khi trang đã được thêm vào màn hình chính, nên ở đó cả ba
 * phép kiểm tra dưới đây đều cần thiết.
 */
export const isPushSupported = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
    return false;
  }
  try {
    return await isSupported();
  } catch {
    return false;
  }
};

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;

/** Một app, một messaging cho cả tab. Khởi tạo lười, vì phần lớn phiên không cần. */
const resolveMessaging = (config: PushConfig): Messaging => {
  app ??= initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  messaging ??= getMessaging(app);
  return messaging;
};

/**
 * ★ CẤU HÌNH ĐI KÈM URL CỦA SERVICE WORKER, KHÔNG NHÚNG CỨNG TRONG FILE ĐÓ.
 * `public/` không qua Vite nên không có `import.meta.env` ở trong; chép tay
 * config sang đấy nghĩa là hai nơi phải sửa cùng lúc, và cái bị quên sẽ khiến
 * thông báo nền im lặng — kiểu hỏng không ai nhìn thấy. Truyền qua query
 * string thì chỉ còn một nguồn sự thật.
 */
const registerServiceWorker = async (config: PushConfig): Promise<ServiceWorkerRegistration> => {
  const params = new URLSearchParams({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  const registration = await navigator.serviceWorker.register(
    `${SERVICE_WORKER_PATH}?${params.toString()}`,
  );
  // `getToken` cần một registration ĐÃ SẴN SÀNG; một cái vừa đăng ký vẫn đang
  // cài đặt sẽ làm nó thất bại với lỗi không nói lên điều gì.
  await navigator.serviceWorker.ready;
  return registration;
};

export type PushTokenResult =
  | { status: 'ok'; token: string }
  | { status: 'unsupported' }
  | { status: 'unconfigured' }
  | { status: 'denied' }
  | { status: 'failed'; reason: string };

/**
 * Xin quyền, đăng ký service worker, lấy token FCM.
 *
 * ★ XIN QUYỀN CHỈ KHI NGƯỜI TA VỪA BẤM. Hàm này không bao giờ được gọi lúc
 * tải trang: một hộp thoại quyền bật lên mà không ai yêu cầu gần như luôn bị
 * bấm "Chặn", và quyền đã bị chặn thì không xin lại được từ trong trang nữa.
 */
export const requestPushToken = async (): Promise<PushTokenResult> => {
  if (!(await isPushSupported())) return { status: 'unsupported' };

  const config = pushConfig();
  if (!config) return { status: 'unconfigured' };

  const permission = await Notification.requestPermission();
  // `default` nghĩa là người dùng đóng hộp thoại mà không chọn gì — vẫn là
  // "chưa được phép", và nói như bị từ chối là câu đúng nhất có thể nói.
  if (permission !== 'granted') return { status: 'denied' };

  try {
    const registration = await registerServiceWorker(config);
    const token = await getToken(resolveMessaging(config), {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { status: 'failed', reason: 'FCM không cấp token nào.' };
    return { status: 'ok', token };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * Token hiện tại của máy này, nếu đã có — KHÔNG xin quyền.
 *
 * Dùng khi tắt thông báo hoặc khi đăng xuất: lúc đó cần biết token nào phải
 * báo cho máy chủ thu hồi, và bật một hộp thoại quyền ở thời điểm ấy là vô lý.
 */
export const currentPushToken = async (): Promise<string | null> => {
  if (!(await isPushSupported())) return null;
  const config = pushConfig();
  if (!config) return null;
  if (Notification.permission !== 'granted') return null;

  try {
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    if (!registration) return null;
    const token = await getToken(resolveMessaging(config), {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch {
    return null;
  }
};

/** Xoá token khỏi máy này. Lỗi ở đây không đáng chặn việc tắt thông báo. */
export const deletePushToken = async (): Promise<void> => {
  const config = pushConfig();
  if (!config) return;
  try {
    await deleteToken(resolveMessaging(config));
  } catch {
    // Token đã biến mất là đúng kết quả mong muốn.
  }
};

/**
 * Thông điệp đến trong lúc tab đang mở.
 *
 * ★ Ở ĐÂY KHÔNG AI GỌI `new Notification(...)`. Khi trang đang hiển thị, hệ
 * điều hành KHÔNG hiện thông báo nền, nhưng nếu trang tự dựng một cái nữa thì
 * một số trình duyệt lại hiện cả hai. Nên phần foreground chỉ báo nhẹ trong
 * trang và để service worker độc quyền việc hiện thông báo hệ thống — đó là
 * cách duy nhất chắc chắn không trùng.
 *
 * Trả về hàm huỷ đăng ký, để React dọn được trong `useEffect`.
 */
export const onPushMessage = (
  handler: (message: { title?: string; body?: string; link?: string }) => void,
): (() => void) => {
  const config = pushConfig();
  if (!config) return () => undefined;
  try {
    return onMessage(resolveMessaging(config), (payload) => {
      handler({
        title: payload.notification?.title,
        body: payload.notification?.body,
        link: payload.data?.['link'],
      });
    });
  } catch {
    return () => undefined;
  }
};
