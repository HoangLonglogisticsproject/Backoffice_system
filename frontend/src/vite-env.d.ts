/// <reference types="vite/client" />

/**
 * Biến môi trường của bản build, có kiểu.
 *
 * ★ KHAI BÁO Ở ĐÂY ĐỂ MỘT TÊN GÕ SAI LÀ LỖI BIÊN DỊCH. Không có khối này,
 * `import.meta.env.VITE_FIREBAE_APP_ID` chỉ là `undefined` lúc chạy — và hậu
 * quả (thông báo im lặng không bao giờ bật được) chỉ lộ ra trên máy thật.
 *
 * ⚠ MỌI THỨ Ở ĐÂY NẰM TRONG BUNDLE VÀ AI CŨNG ĐỌC ĐƯỢC. Firebase web config
 * là công khai theo thiết kế — nó định danh project chứ không cấp quyền.
 * Service account và private key thuộc về backend; chúng không bao giờ mang
 * tiền tố `VITE_`.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;

  // Firebase Web Push — xem src/utils/push.ts. Thiếu một mảnh thì nút bật
  // thông báo tự báo "chưa cấu hình" thay vì thất bại khó hiểu.
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** Web Push certificate (khoá công khai). Firebase Console → Cloud Messaging. */
  readonly VITE_FIREBASE_VAPID_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
