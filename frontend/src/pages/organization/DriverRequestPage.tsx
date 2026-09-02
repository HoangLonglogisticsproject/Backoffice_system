import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { formatDateTime } from '@/utils/format/datetime';
import { isApiError } from '@/utils/errors';
import {
  approveDriverRequest,
  fetchMyDriverRequests,
  fetchPendingDriverRequests,
  rejectDriverRequest,
  type DriverAccountRequest,
  type DriverRequestStatus,
  type ProvisionedDriver,
} from '@/api/driverAccounts';
import type { TranslationKey } from '@/types/translate';

/**
 * Driver account requests — the queue, and the decision.
 *
 * ★ ONE PAGE, TWO AUDIENCES, AND THE DIFFERENCE IS NOT COSMETIC. A global
 * administrator sees everything still waiting and can decide it. A department
 * head sees only what THEY proposed and can decide nothing — including their
 * own, which the server refuses outright.
 *
 * Which list is fetched follows from what the caller holds, and the decision
 * controls are rendered only for somebody who may actually use them. The server
 * enforces both; this only avoids offering an action that would be refused.
 */

const STATUS_LABEL: Record<DriverRequestStatus, TranslationKey> = {
  pending: 'driverRequestStatusPending',
  approved: 'driverRequestStatusApproved',
  rejected: 'driverRequestStatusRejected',
};

const STATUS_VARIANT: Record<DriverRequestStatus, 'secondary' | 'default' | 'destructive'> = {
  pending: 'secondary',
  approved: 'default',
  rejected: 'destructive',
};

export default function DriverRequestPage() {
  const { t, language } = useLanguage();
  /** A server sentence when there is one; a generic failure otherwise. */
  const messageOf = (failure: unknown) =>
    isApiError(failure) ? failure.message : t('createFailed');
  const { can } = useSession();

  const mayDecide = can('user.write');

  const [requests, setRequests] = useState<DriverAccountRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * ★ SHOWN ONCE AND NEVER FETCHED AGAIN. The generated password exists in this
   * response and nowhere else a screen can reach — reloading the page loses it,
   * which is the correct behaviour for a hand-over credential.
   */
  const [created, setCreated] = useState<ProvisionedDriver | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(mayDecide ? await fetchPendingDriverRequests() : await fetchMyDriverRequests());
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, [mayDecide]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = mayDecide ? t('driverRequestQueue') : t('driverRequestMine');

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold">{title}</h1>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {created ? <CreatedDriverNote driver={created} onDismiss={() => setCreated(null)} /> : null}

      {requests === null ? <p className="text-sm text-gray-500">…</p> : null}

      {requests !== null && requests.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">{t('driverRequestQueueEmpty')}</p>
      ) : null}

      {requests !== null && requests.length > 0 ? (
        <ul className="space-y-3">
          {requests.map((row) => (
            <RequestCard
              key={row.id}
              request={row}
              language={language}
              mayDecide={mayDecide}
              onDecided={(driver) => {
                if (driver) setCreated(driver);
                void load();
              }}
              onError={setError}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The temporary password, exactly once.
 *
 * ★ IT IS NOT STORED ANYWHERE THIS SCREEN CAN RE-READ. It was generated during
 * approval and returned in that one response; the request row never held it.
 */
function CreatedDriverNote({
  driver,
  onDismiss,
}: Readonly<{ driver: ProvisionedDriver; onDismiss: () => void }>) {
  const { t } = useLanguage();

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
      <p className="font-medium text-green-900">{t('driverCreatedTitle')}</p>
      <p className="mt-1 text-sm text-green-900">
        {driver.displayName} · {driver.username}
      </p>
      {driver.temporaryPassword ? (
        <>
          <p className="mt-2 text-xs font-medium text-green-900">{t('temporaryPasswordTitle')}</p>
          <code className="mt-1 block rounded bg-white px-2 py-1 font-mono text-sm">
            {driver.temporaryPassword}
          </code>
          <p className="mt-1 text-xs text-green-800">{t('temporaryPasswordBody')}</p>
        </>
      ) : null}
      <Button variant="outline" size="sm" className="mt-2" onClick={onDismiss}>
        OK
      </Button>
    </div>
  );
}

function RequestCard({
  request,
  language,
  mayDecide,
  onDecided,
  onError,
}: Readonly<{
  request: DriverAccountRequest;
  language: 'vi' | 'en';
  mayDecide: boolean;
  onDecided: (driver: ProvisionedDriver | null) => void;
  onError: (message: string) => void;
}>) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const reasonMissing = reason.trim() === '';
  const decidable = mayDecide && request.status === 'pending';

  const run = async (work: () => Promise<ProvisionedDriver | null>) => {
    setBusy(true);
    try {
      onDecided(await work());
    } catch (failure) {
      onError(isApiError(failure) ? failure.message : t('createFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{request.displayName}</p>
          <p className="truncate text-sm text-gray-600">{request.email}</p>
        </div>
        <Badge variant={STATUS_VARIANT[request.status]}>{t(STATUS_LABEL[request.status])}</Badge>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
        <Field label={t('driverRequestRequester')} value={request.requester.displayName} />
        <Field label={t('driverRequestedAt')} value={formatDateTime(request.requestedAt, language)} />
        {request.decider ? (
          <Field label={t('driverRequestDecidedBy')} value={request.decider.displayName} />
        ) : null}
        {request.decidedAt ? (
          <Field label={t('driverRequestDecidedAt')} value={formatDateTime(request.decidedAt, language)} />
        ) : null}
      </dl>

      {/* ★ THE REJECTION REASON IS THE POINT OF KEEPING HISTORY. Without it a
          head knows only that they were refused. */}
      {request.decisionReason ? (
        <div className="mt-2 rounded bg-gray-50 px-2 py-1">
          <p className="text-xs font-medium text-gray-700">{t('driverRequestRejectReason')}</p>
          <p className="text-sm">{request.decisionReason}</p>
        </div>
      ) : null}

      {decidable ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <label htmlFor={`reject-reason-${request.id}`} className="block text-xs font-medium text-gray-700">
            {t('driverRequestRejectReason')}
          </label>
          <Input
            id={`reject-reason-${request.id}`}
            value={reason}
            placeholder={t('driverRequestRejectReasonHint')}
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setReasonTouched(true)}
          />
          {reasonTouched && reasonMissing ? (
            <p className="text-xs text-red-600">{t('driverRequestReasonRequired')}</p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="destructive"
              className="flex-1"
              // A blank reason is unsendable: the server refuses it with a CHECK
              // the row cannot exist without, so this stops the round trip.
              disabled={busy || reasonMissing}
              onClick={() => {
                setReasonTouched(true);
                if (!reasonMissing) {
                  void run(async () => {
                    await rejectDriverRequest(request.id, reason.trim());
                    return null;
                  });
                }
              }}
            >
              {t('driverRequestReject')}
            </Button>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() =>
                void run(async () => (await approveDriverRequest(request.id)).driver)
              }
            >
              {t('driverRequestApprove')}
            </Button>
          </div>

          <p className="text-xs text-gray-500">{t('driverRequestApproveWarning')}</p>
        </div>
      ) : null}
    </li>
  );
}

function Field({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
