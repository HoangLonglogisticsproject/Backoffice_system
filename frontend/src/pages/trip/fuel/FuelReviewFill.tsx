import { fuelEvidenceContentUrl } from '@/api/fuelEvidence';
import { StatusPill } from '@/components/common/StatusPill';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FuelReviewDetail } from '@/types/fuel';
import type { Language } from '@/types/translate';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay, formatDateTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { EVIDENCE_LABEL, FUEL_STATUS_LABEL, MATCH_LEVEL } from '@/utils/fuelStatus';

type Fill = FuelReviewDetail['fill'];

/** The trip a fill arose on — its day, and its customer when there is one. */
const tripOf = (trip: Fill['trip'], language: Language): string => {
  if (!trip) return '—';
  const day = formatCalendarDay(trip.scheduledOn, language);
  return trip.customerName ? `${day} · ${trip.customerName}` : day;
};

/**
 * What Accounting reads before deciding — read-only: the photos (the
 * station's QR among them, to pay from, never read by the app), the figures
 * from the money row and the facts from the receipt, look-alikes, and every
 * step so far with who took it and why.
 */
export function FuelReviewFill({ detail }: Readonly<{ detail: FuelReviewDetail }>) {
  const { t, language } = useLanguage();
  const { fill } = detail;
  const document = [fill.document?.series, fill.document?.number].filter(Boolean).join(' · ');
  return (
    <>
      <ul className="flex flex-wrap gap-3" aria-label={t('fuelImagesLabel')}>
        {fill.evidence.map((image) => {
          const label = t(image.evidenceType ? EVIDENCE_LABEL[image.evidenceType] : 'fuelEvidenceOther');
          return (
            <li key={image.id} className="w-32 space-y-1">
              <a href={fuelEvidenceContentUrl(image.id)} target="_blank" rel="noreferrer">
                <img src={fuelEvidenceContentUrl(image.id)} alt={label} className="size-32 rounded-lg border object-cover" />
              </a>
              <span className="block text-xs text-gray-600">{label}</span>
            </li>
          );
        })}
        {fill.evidence.length === 0 ? <li className="text-amber-700">{t('fuelReviewNoImages')}</li> : null}
      </ul>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-gray-50 p-3 sm:grid-cols-3">
        <Fact label={t('fuelAmount')} value={`${formatMoney(fill.amount)} đ`} />
        <Fact label={t('fuelLiters')} value={fill.liters ?? '—'} />
        <Fact label={t('fuelUnitPrice')} value={fill.unitPrice ? `${formatMoney(fill.unitPrice)} đ/L` : '—'} />
        <Fact label={t('fuelOdometer')} value={fill.odometerKm?.toLocaleString('vi-VN') ?? '—'} />
        <Fact label={t('fuelVendorName')} value={fill.vendor?.name ?? '—'} />
        <Fact label={t('fuelVendorTaxCode')} value={fill.vendor?.taxCode ?? '—'} />
        <Fact label={t('fuelDocumentNumber')} value={document || '—'} />
        <Fact label={t('fuelColDriver')} value={fill.driver?.displayName ?? '—'} />
        <Fact label={t('fuelColWhen')} value={formatDateTime(fill.occurredAt ?? fill.recordedAt, language)} />
        <Fact label={t('fuelTrip')} value={tripOf(fill.trip, language)} />
      </dl>

      {detail.warnings.length > 0 ? (
        <section aria-label={t('fuelReviewWarnings')} className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="font-medium text-amber-900">{t('fuelReviewWarnings')}</p>
          <ul className="space-y-1">
            {detail.warnings.map((warning) => (
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
        {detail.history.map((step) => (
          <li key={step.seq} className="text-xs text-gray-600">
            <span className="font-medium text-gray-900">{t(FUEL_STATUS_LABEL[step.status])}</span> · {step.actor.displayName} ·{' '}
            {formatDateTime(step.at, language)}
            {step.note ? ` — “${step.note}”` : ''}
          </li>
        ))}
      </ol>
    </>
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
