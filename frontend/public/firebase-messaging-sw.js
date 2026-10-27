/* eslint-disable */
/**
 * Service worker nhận Web Push khi trang đã đóng.
 *
 * ★ FILE NÀY KHÔNG QUA VITE. Nó nằm trong `public/`, được phục vụ nguyên văn,
 * nên ở đây không có `import.meta.env`, không có bundler, không có TypeScript.
 * Vì thế Firebase được nạp bằng `importScripts` từ CDN, và cấu hình đến từ
 * QUERY STRING mà `src/utils/push.ts` gắn vào lúc đăng ký — một nguồn sự thật,
 * thay vì một bản chép tay sẽ lệch đi vào ngày ai đó đổi project.
 *
 * ★ VÀ NÓ LÀ NƠI DUY NHẤT HIỆN THÔNG BÁO HỆ THỐNG. Trang đang mở chỉ hiện một
 * toast trong giao diện (xem `onPushMessage`); nếu cả hai cùng dựng thông báo,
 * một số trình duyệt sẽ hiện hai cái cho cùng một sự kiện.
 */

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;

firebase.initializeApp({
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
});

const messaging = firebase.messaging();

/** Nhãn cố định: một lượt nhắc mới cho cùng một chuyến THAY THẾ cái cũ, không chồng lên. */
const TAG = 'hoanglong-departure-reminder';

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(notification.title || 'Thông báo', {
    body: notification.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: TAG,
    renotify: true,
    data: { link: data.link || '/driver' },
  });
});

/**
 * Bấm vào thông báo thì mở đúng trang chi tiết chuyến.
 *
 * ★ TÌM TAB ĐANG MỞ TRƯỚC, MỞ TAB MỚI SAU. Một tài xế đã có portal mở sẵn
 * không nên nhận thêm một cửa sổ thứ hai của cùng ứng dụng — nên nếu có
 * client nào đang sống, nó được focus và điều hướng tại chỗ.
 *
 * ★ ĐƯỜNG DẪN ĐƯỢC GHÉP VỚI ORIGIN CỦA CHÍNH SERVICE WORKER. Thông điệp chỉ
 * mang một đường dẫn tương đối, nên không có cách nào để một payload điều
 * hướng trình duyệt ra khỏi hệ thống này.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const path = (event.notification.data && event.notification.data.link) || '/driver';
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'navigate' in client) {
          return client.focus().then((focused) => focused.navigate(target));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
