import { useId, useState } from 'react';
import { fuelEvidenceContentUrl } from '@/api/fuelEvidence';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDecideFuelReview, useFuelReview } from '@/hooks/trip/useFuelReviews';
import type { FuelReviewAction, FuelReviewStatus } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';
import { cn } from '@/utils/cn';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay, formatDateTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { EVIDENCE_LABEL, FUEL_STATUS_LABEL, FUEL_STATUS_TONE, MATCH_LEVEL } from '@/utils/fuelStatus';

/** What Accounting may do from each state — the server's machine, offered, never decided here. */
const ACTIONS: Record<FuelReviewStatus, Array<{ action: FuelReviewAction; label: TranslationKey; primary?: boolean }>> = {
  submitted: [
    { action: 'request-info', label: 'fuelActionRequestInfo' },
    { action: 'reject', label: 'fuelActionReject' },
    { action: 'approve', label: 'fuelActionApprove', primary: true },
  ],
  needs_info: [{ action: 'reject', label: 'fuelActionReject' }],
  approved: [{ action: 'mark-paid', label: 'fuelActionMarkPaid', primary: true }],
  paid: [], rejected: [], // final: nothing more to decide
};
const NEEDS_NOTE = new Set<FuelReviewAction>(['request-info', 'reject']);

/**
 * One driver's fill, as Accounting decides on it: the photos (the station's QR among them, to pay from —
 * never read by the app), the money row's figures, the receipt's facts, look-alikes, and every step.
 * Asking for more or refusing needs a note the driver reads; paying may carry the transfer reference.
 */
export function FuelReviewDetailDialog({ id, onClose }: Readonly<{ id: string; onClose: () => void }>) {
  const { t, language } = useLanguage();
  const noteId = useId();
  const { data, isError } = useFuelReview(id);
  const decide = useDecideFuelReview(id);
  const [note, setNote] = useState('');
  const fill = data?.fill;
  const actions = data ? ACTIONS[data.status] : [];

  const run = (action: FuelReviewAction) =>
    decide.mutate({ action, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: () => setNote('') });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('fuelReviewTitle')}
      className="max-w-3xl"
      footer={
        actions.length > 0 ? (
          <div className="flex w-full flex-wrap items-end justify-end gap-2">
            {actions.map((entry) => (
              <Button
                key={entry.action}
                variant={entry.primary ? 'default' : 'outline'}
                disabled={decide.isPending || (NEEDS_NOTE.has(entry.action) && note.trim() === '')}
                onClick={() => run(entry.action)}
              >
                {t(entry.label)}
              </Button>
            ))}
          </div>
        ) : undefined
      }
    >
      {isError ? <p role="alert" className="text-sm text-red-600">{t('loadFailed')}</p> : null}
      {data && fill ? (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-base font-semibold">
              {fill.vehicle ? formatPlate(fill.vehicle.plate) : '—'} · {formatMoney(fill.amount)} đ
            </span>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', FUEL_STATUS_TONE[data.status])}>
              {t(FUEL_STATUS_LABEL[data.status])}
            </span>
          </div>

          <ul className="flex flex-wrap gap-3" aria-label={t('fuelImagesLabel')}>
            {fill.evidence.map((image) => (
              <li key={image.id} className="w-32 space-y-1">
                <a href={fuelEvidenceContentUrl(image.id)} target="_blank" rel="noreferrer">
                  <img src={fuelEvidenceContentUrl(image.id)} alt={t(image.evidenceType ? EVIDENCE_LABEL[image.evidenceType] : 'fuelImagesLabel')} className="size-32 rounded-lg border object-cover" />
                </a>
                <span className="block text-xs text-gray-600">{t(image.evidenceType ? EVIDENCE_LABEL[image.evidenceType] : 'fuelEvidenceOther')}</span>
              </li>
            ))}
            {fill.evidence.length === 0 ? <li className="text-amber-700">{t('fuelReviewNoImages')}</li> : null}
          </ul>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-gray-50 p-3 sm:grid-cols-3">
            <Fact label={t('fuelAmount')} value={`${formatMoney(fill.amount)} đ`} />
            <Fact label={t('fuelLiters')} value={fill.liters ?? '—'} />
            <Fact label={t('fuelUnitPrice')} value={fill.unitPrice ? `${formatMoney(fill.unitPrice)} đ/L` : '—'} />
            <Fact label={t('fuelOdometer')} value={fill.odometerKm?.toLocaleString('vi-VN') ?? '—'} />
            <Fact label={t('fuelVendorName')} value={fill.vendor?.name ?? '—'} />
            <Fact label={t('fuelVendorTaxCode')} value={fill.vendor?.taxCode ?? '—'} />
            <Fact label={t('fuelDocumentNumber')} value={[fill.document?.series, fill.document?.number].filter(Boolean).join(' · ') || '—'} />
            <Fact label={t('fuelColDriver')} value={fill.driver?.displayName ?? '—'} />
            <Fact label={t('fuelColWhen')} value={formatDateTime(fill.occurredAt ?? fill.recordedAt, language)} />
            <Fact label={t('fuelTrip')} value={fill.trip ? `${formatCalendarDay(fill.trip.scheduledOn, language)}${fill.trip.customerName ? ` · ${fill.trip.customerName}` : ''}` : '—'} />
          </dl>

          {data.warnings.length > 0 ? (
            <section aria-label={t('fuelReviewWarnings')} className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="font-medium text-amber-900">{t('fuelReviewWarnings')}</p>
              <ul className="space-y-1">
                {data.warnings.map((warning) => (
                  <li key={`${warning.backing.ledger}:${warning.backing.costId}`} className="flex flex-wrap items-center gap-2 text-xs">
                    {warning.level ? <StatusPill tone={MATCH_LEVEL[warning.level].tone}>{t(MATCH_LEVEL[warning.level].label)}</StatusPill> : null}
                    <span className="tabular-nums">{formatMoney(warning.amount)} đ</span>
                    <span>· {warning.businessDate ? formatCalendarDay(warning.businessDate, language) : '—'}</span>
                    <span>· {warning.vehicle ? formatPlate(warning.vehicle.plate) : t('fuelLorryUnknown')}</span>
                    <span>· {warning.driver?.displayName ?? '—'}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <ol className="space-y-1 border-l pl-3" aria-label={t('fuelReviewHistory')}>
            {data.history.map((step) => (
              <li key={step.seq} className="text-xs text-gray-600">
                <span className="font-medium text-gray-900">{t(FUEL_STATUS_LABEL[step.status])}</span> · {step.actor.displayName} ·{' '}
                {formatDateTime(step.at, language)}
                {step.note ? ` — “${step.note}”` : ''}
              </li>
            ))}
          </ol>

          {actions.length > 0 ? (
            <div>
              <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-gray-600">{t('fuelReviewNote')}</label>
              <textarea
                id={noteId}
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">{t('fuelReviewNoteHint')}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function Fact({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
