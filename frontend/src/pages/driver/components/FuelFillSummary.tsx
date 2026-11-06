import { driverFuelPhotoUrl } from '@/api/driverFuel';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DriverFuelSubmissionDetail } from '@/types/fuel';
import { cn } from '@/utils/cn';
import { formatPlate } from '@/utils/format';
import { formatDateTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { FUEL_STATUS_LABEL, FUEL_STATUS_TONE } from '@/utils/fuelStatus';

/** The fill as recorded, read-only: its state and Accounting's word, the figures, the photos, the steps. */
export function FillSummary({ fill }: Readonly<{ fill: DriverFuelSubmissionDetail }>) {
  const { t, language } = useLanguage();
  const spoken = fill.statusNote && (fill.status === 'needs_info' || fill.status === 'rejected');
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold">{formatPlate(fill.vehicle.plate)}</span>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', FUEL_STATUS_TONE[fill.status])}>
          {t(FUEL_STATUS_LABEL[fill.status])}
        </span>
      </div>
      {spoken ? (
        <p role="note" className="rounded-lg bg-amber-50 p-3 text-amber-900">
          <span className="block text-xs font-medium">{t('driverFuelAccountingSays')}</span>“{fill.statusNote}”
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3">
        <div><dt className="text-xs text-muted-foreground">{t('driverFuelAmount')}</dt><dd className="font-semibold tabular-nums">{formatMoney(fill.amount)} đ</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t('driverFuelLiters')}</dt><dd className="font-semibold">{fill.liters ?? '—'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t('driverReceiptVendor')}</dt><dd>{fill.vendor?.name ?? '—'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t('driverReceiptNumber')}</dt><dd>{fill.document?.number ?? '—'}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-muted-foreground">{t('driverFuelRecordedAt')}</dt><dd>{formatDateTime(fill.recordedAt, language)}</dd></div>
      </dl>
      {fill.evidence.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('driverPhotosSent')}>
          {fill.evidence.map((image) => (
            <li key={image.id}>
              <img src={driverFuelPhotoUrl(image.id)} alt={image.originalFilename ?? t('driverPhotoOther')} className="size-20 rounded-lg border object-cover" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('driverFuelNoPhotos')}</p>
      )}
      <ol className="space-y-1 border-l pl-3" aria-label={t('driverFuelHistory')}>
        {fill.history.map((step) => (
          <li key={`${step.status}-${step.at}`} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t(FUEL_STATUS_LABEL[step.status])}</span> · {formatDateTime(step.at, language)}
            {step.note ? ` — “${step.note}”` : ''}
          </li>
        ))}
      </ol>
    </>
  );
}
