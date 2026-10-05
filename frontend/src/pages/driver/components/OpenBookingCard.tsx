import { Hand, Undo2 } from 'lucide-react';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DriverOpenBookingItem } from '@/types/openBooking';
import { BookingSummary } from './BookingSummary';

interface Props {
  booking: DriverOpenBookingItem;
  /** This card's own request is in flight — its button is held, the others are not. */
  busy: boolean;
  onAsk: () => void;
  onWithdraw: (requestId: string) => void;
}

/**
 * One open booking: decide, then one large, labelled action.
 *
 * ★ "XIN NHẬN CHUYẾN" ASKS — IT DOES NOT TAKE. The card then says the ask is
 * waiting, and offers to take it back; the trip itself appears in "Chuyến của
 * tôi" only when Dispatch approves and chooses the lorry.
 */
export function OpenBookingCard({ booking, busy, onAsk, onWithdraw }: Readonly<Props>) {
  const { t } = useLanguage();
  const pending = booking.myPendingRequestId;

  return (
    <Card>
      <CardContent className="space-y-3">
        <BookingSummary booking={booking} />

        <div className="space-y-2 border-t border-border pt-3">
          {pending ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusPill tone="amber">{t('requestStatePending')}</StatusPill>
              <Button type="button" variant="outline" className="h-11 gap-2 px-4" disabled={busy} onClick={() => onWithdraw(pending)}>
                <Undo2 className="size-4" aria-hidden />
                {t('requestWithdraw')}
              </Button>
            </div>
          ) : (
            <Button type="button" className="h-12 w-full gap-2 text-base" disabled={busy} onClick={onAsk}>
              <Hand className="size-5" aria-hidden />
              {busy ? t('openBookingAsking') : t('openBookingAsk')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
