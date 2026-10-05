import { Link } from 'react-router-dom';
import { ChevronRight, Undo2 } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatTimeOnDay } from '@/utils/format/datetime';
import type { TranslationKey } from '@/types/translate';
import type { DriverAssignmentRequest } from '@/types/openBooking';
import { BookingSummary } from './BookingSummary';

interface Props {
  request: DriverAssignmentRequest;
  busy: boolean;
  onWithdraw: () => void;
}

/** How each outcome reads. Superseded says WHY — taken by someone else, or closed. */
const statusOf = (request: DriverAssignmentRequest): { label: TranslationKey; tone: StatusTone } => {
  switch (request.state) {
    case 'pending':
      return { label: 'requestStatePending', tone: 'amber' };
    case 'approved':
      return { label: 'requestStateApproved', tone: 'green' };
    case 'rejected':
      return { label: 'requestStateRejected', tone: 'red' };
    case 'withdrawn':
      return { label: 'requestStateWithdrawn', tone: 'gray' };
    case 'superseded':
      return {
        label: request.supersededBecause === 'trip_assigned' ? 'requestStateTakenByOther' : 'requestStateClosed',
        tone: 'gray',
      };
  }
};

/**
 * One of the driver's own asks and where it stands.
 *
 * ★ AN APPROVED ASK LEADS TO THE TRIP THROUGH ITS ASSIGNMENT — the existing
 * driver view, with its existing guard. Nothing about the trip is read here
 * beyond the same safe projection the open booking showed.
 */
export function AssignmentRequestCard({ request, busy, onWithdraw }: Readonly<Props>) {
  const { t, language } = useLanguage();
  const status = statusOf(request);

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill tone={status.tone}>{t(status.label)}</StatusPill>
          <span className="text-xs text-muted-foreground">
            {t('requestSentAt')} {formatTimeOnDay(request.requestedAt, language)}
          </span>
        </div>

        <BookingSummary booking={request.booking} />

        {request.state === 'rejected' && request.rejectionReason ? (
          <p className="text-sm whitespace-pre-wrap">
            <span className="text-muted-foreground">{t('notifReason')}:</span> {request.rejectionReason}
          </p>
        ) : null}

        {request.state === 'pending' ? (
          <Button type="button" variant="outline" className="h-11 w-full gap-2" disabled={busy} onClick={onWithdraw}>
            <Undo2 className="size-4" aria-hidden />
            {t('requestWithdraw')}
          </Button>
        ) : null}
        {request.assignmentId ? (
          <Link
            to={`/driver/assignments/${encodeURIComponent(request.assignmentId)}`}
            className="flex h-11 items-center justify-center gap-1 rounded-lg border border-border text-sm font-medium text-blue-700"
          >
            {t('driverViewTrip')}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
