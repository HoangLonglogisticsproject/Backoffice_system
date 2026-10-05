import { useLanguage } from '@/contexts/LanguageContext';
import { useBookingRequests, useMyAssignmentRequests, useOpenBookings } from '@/hooks/driver/openBookings';
import { isFinalRefusal } from '@/utils/driverErrors';
import type { ApiError } from '@/utils/errors';
import type { TranslationKey } from '@/types/translate';
import { AssignmentCardSkeleton } from './AssignmentCard';
import { AssignmentRequestCard } from './AssignmentRequestCard';
import { DriverLoadError } from './DriverLoadError';
import { OpenBookingCard } from './OpenBookingCard';

/**
 * "Booking đang mở" and "Yêu cầu của tôi" — the two sections a driver uses to
 * ask for work (0035). Each list is the server's: what is open now, and the
 * caller's own asks; nothing here narrows or widens either.
 */

/** A failed refresh keeps the cards on screen; a refusal (401/403) takes them away. */
const blocks = (error: ApiError | null, count: number): boolean =>
  Boolean(error) && (count === 0 || isFinalRefusal(error));

function ListFrame({
  intro,
  empty,
  loading,
  error,
  count,
  reload,
  children,
}: Readonly<{
  intro?: TranslationKey;
  empty: TranslationKey;
  loading: boolean;
  error: ApiError | null;
  count: number;
  reload: () => void;
  children: React.ReactNode;
}>) {
  const { t } = useLanguage();
  const blocked = blocks(error, count);
  return (
    <div className="space-y-3">
      {intro ? <p className="text-sm text-muted-foreground">{t(intro)}</p> : null}
      {loading ? (
        <div className="space-y-3">
          <output className="sr-only">{t('driverLoading')}</output>
          <AssignmentCardSkeleton />
        </div>
      ) : null}
      {error ? <DriverLoadError error={error} onRetry={reload} /> : null}
      {!loading && !blocked && count === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t(empty)}</p>
      ) : null}
      {!loading && !blocked && count > 0 ? <ul className="space-y-3">{children}</ul> : null}
    </div>
  );
}

export function OpenBookingsSection() {
  const { items, loading, error, reload } = useOpenBookings();
  const { ask, withdraw } = useBookingRequests();

  return (
    <ListFrame intro="openBookingIntro" empty="openBookingEmpty" loading={loading} error={error} count={items.length} reload={reload}>
      {items.map((booking) => (
        <li key={booking.tripId}>
          <OpenBookingCard
            booking={booking}
            busy={
              (ask.isPending && ask.variables === booking.tripId) ||
              (withdraw.isPending && withdraw.variables === booking.myPendingRequestId)
            }
            onAsk={() => ask.mutate(booking.tripId)}
            onWithdraw={(requestId) => withdraw.mutate(requestId)}
          />
        </li>
      ))}
    </ListFrame>
  );
}

export function MyRequestsSection() {
  const { items, loading, error, reload } = useMyAssignmentRequests();
  const { withdraw } = useBookingRequests();

  return (
    <ListFrame empty="requestEmpty" loading={loading} error={error} count={items.length} reload={reload}>
      {items.map((request) => (
        <li key={request.id}>
          <AssignmentRequestCard
            request={request}
            busy={withdraw.isPending && withdraw.variables === request.id}
            onWithdraw={() => withdraw.mutate(request.id)}
          />
        </li>
      ))}
    </ListFrame>
  );
}
