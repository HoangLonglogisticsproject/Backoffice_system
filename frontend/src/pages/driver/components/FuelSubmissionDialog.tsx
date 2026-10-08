import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { driverFuelPhotoUrl } from '@/api/driverFuel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFuelPhotos, useMyFuelSubmission, useResubmitFuel } from '@/hooks/driver/fuel';
import { cn } from '@/utils/cn';
import { driverErrorKey } from '@/utils/driverErrors';
import { formatPlate } from '@/utils/format';
import { formatDateTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { FUEL_STATUS_LABEL, FUEL_STATUS_TONE } from '@/utils/fuelStatus';
import { DriverLoadError } from './DriverLoadError';
import { FuelPhotoPicker } from './FuelPhotoPicker';

/**
 * One of the driver's own fills: what was recorded, where Accounting's check
 * stands and why, the photos they sent — and, only when Accounting asked
 * ("Cần bổ sung"), the way to answer: more photos, a station or an invoice
 * number not given before, a word back. What was already recorded is shown,
 * never editable: a wrong amount is Accounting's to refuse, then a new fill.
 */
export function FuelSubmissionDialog({ id, onClose }: Readonly<{ id: string; onClose: () => void }>) {
  const { t, language } = useLanguage();
  const field = useId();
  const { data: fill, error, refetch } = useMyFuelSubmission(id);
  const photos = useFuelPhotos();
  const resubmit = useResubmitFuel();
  const [vendorName, setVendorName] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [note, setNote] = useState('');
  const asked = fill?.status === 'needs_info';

  const send = async () => {
    await resubmit.mutateAsync({
      id,
      input: {
        ...(vendorName.trim() ? { vendorName: vendorName.trim() } : {}),
        ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        evidence: photos.evidence(),
      },
    });
    await photos.clear();
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('driverFuelDetailTitle')}
      footer={
        <>
          <Button variant="ghost" size="lg" className="h-11" onClick={onClose}>
            {t('reviewClose')}
          </Button>
          {asked ? (
            <Button size="lg" className="h-11 flex-1" disabled={resubmit.isPending} onClick={() => void send().catch(() => undefined)}>
              {resubmit.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('driverFuelResubmit')}
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <DriverLoadError error={error} onRetry={() => void refetch()} /> : null}
      {fill ? (
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-semibold">{formatPlate(fill.vehicle.plate)}</span>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', FUEL_STATUS_TONE[fill.status])}>
              {t(FUEL_STATUS_LABEL[fill.status])}
            </span>
          </div>
          {fill.statusNote && (asked || fill.status === 'rejected') ? (
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

          {asked ? (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="font-medium">{t('driverFuelSupplement')}</p>
              <FuelPhotoPicker photos={photos} />
              {fill.vendor?.name ? null : (
                <div>
                  <label htmlFor={`${field}-vendor`} className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('driverReceiptVendor')}</label>
                  <Input id={`${field}-vendor`} className="h-11" maxLength={200} value={vendorName} onChange={(event) => setVendorName(event.target.value)} />
                </div>
              )}
              {fill.document?.number ? null : (
                <div>
                  <label htmlFor={`${field}-number`} className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('driverReceiptNumber')}</label>
                  <Input id={`${field}-number`} className="h-11" maxLength={40} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} />
                </div>
              )}
              <div>
                <label htmlFor={`${field}-note`} className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('driverFuelReplyNote')}</label>
                <Input id={`${field}-note`} className="h-11" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
              </div>
              {resubmit.error ? (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                  {t(driverErrorKey(resubmit.error))}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
