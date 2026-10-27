import { BellOff, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { cn } from '@/utils/cn';

/**
 * Bật/tắt thông báo đẩy trên chiếc máy đang dùng.
 *
 * ★ MỘT CÁI NÚT KHÔNG LÀM ĐƯỢC GÌ THÌ KHÔNG ĐƯỢC HIỆN RA. Trình duyệt không
 * hỗ trợ, quyền đã bị chặn, bản build chưa có cấu hình — ba trạng thái đó
 * không sửa được bằng cách bấm, nên ô này nói thẳng chuyện gì đang xảy ra và
 * cất nút đi. Để một cái nút nằm đó cho người ta bấm mãi là cách tệ nhất.
 *
 * ★ VÀ NÓ NÓI VỀ MÁY NÀY, KHÔNG PHẢI VỀ TÀI KHOẢN. Câu chữ ghi rõ "trên máy
 * này", vì một tài xế bật trên điện thoại rồi mở máy tính sẽ thấy "đang tắt" —
 * điều đó đúng, và nếu không nói trước thì nó trông như một lỗi.
 */
export function PushToggle() {
  const { t } = useLanguage();
  const { state, busy, error, enable, disable } = usePushNotifications();

  if (state === 'checking') return null;

  const blocked = state === 'unsupported' || state === 'denied' || state === 'unconfigured';
  const on = state === 'on';

  return (
    <section
      aria-labelledby="push-toggle-heading"
      className="rounded-xl border border-border bg-background px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn('mt-0.5 shrink-0 [&_svg]:size-5', on ? 'text-primary' : 'text-muted-foreground')}
        >
          {on ? <BellRing /> : <BellOff />}
        </span>

        <div className="min-w-0 flex-1">
          <h2 id="push-toggle-heading" className="text-sm font-medium">
            {t('pushTitle')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('pushExplain')}</p>

          {blocked ? (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {t(
                state === 'denied'
                  ? 'pushDenied'
                  : state === 'unsupported'
                    ? 'pushUnsupported'
                    : 'pushFailed',
              )}
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm font-medium">{t(on ? 'pushOn' : 'pushOff')}</p>
              {error ? (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {t('pushFailed')}
                </p>
              ) : null}
            </>
          )}
        </div>

        {blocked ? null : (
          <Button
            type="button"
            variant={on ? 'outline' : 'default'}
            onClick={() => void (on ? disable() : enable())}
            disabled={busy}
          >
            {busy ? t('pushWorking') : t(on ? 'pushDisable' : 'pushEnable')}
          </Button>
        )}
      </div>
    </section>
  );
}
