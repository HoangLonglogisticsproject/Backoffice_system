import { useId, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFuelPhotos } from '@/hooks/driver/fuel';
import type { DailyFuelDeclarationInput, DailyFuelOutcome } from '@/types/driver';
import type { TranslationKey } from '@/types/translate';
import { cn } from '@/utils/cn';
import { newRequestId } from '@/utils/driverDraft';
import { driverErrorKey } from '@/utils/driverErrors';
import { formatPlate } from '@/utils/format';
import { formatCalendarWeekday, todayAsCalendarDay } from '@/utils/format/datetime';
import { FuelPhotoPicker } from './FuelPhotoPicker';

/** Liters as the server takes them: above 0, at most 2 decimals. A comma is read as the point. */
const LITERS = /^\d{1,8}(\.\d{1,2})?$/;
const ODOMETER = /^\d{1,10}$/;
const litersOf = (text: string): string => text.trim().replace(',', '.');

/** The words each mode is told in. A fill asks no question: it is always fuel added. */
const COPY: Record<'check' | 'fill', { title: TranslationKey; intro: TranslationKey; submit: TranslationKey; start: DailyFuelOutcome | null }> = {
  check: { title: 'driverFuelTitle', intro: 'driverFuelIntro', submit: 'driverFuelSubmit', start: null },
  fill: { title: 'driverFillTitle', intro: 'driverFillIntro', submit: 'driverFillSubmit', start: 'fuel_added' },
};

/**
 * "Khai nhiên liệu đầu ca" — opened when the server holds the day's first
 * milestone for the lorry's fuel check (`FUEL_DECLARATION_REQUIRED`), or from
 * "Ca làm việc hôm nay".
 *
 * ★ `mode="fill"` IS "Ghi nhận đổ nhiên liệu": the same readings, no question —
 * a fill after the check is always a fill, and the check's answer stays.
 *
 * ★ THE LORRY AND THE DAY ARE SHOWN, NEVER SENT. The server takes both from the
 * assignment and its own clock; the day here is the handset's reading of the
 * same Asia/Ho_Chi_Minh calendar, for the driver's eyes only.
 *
 * ★ ONE KEY PER OPENING. A retry after a dropped connection reuses it, so the
 * fill is written once; the parent mounts a fresh dialog each time it asks.
 * "Không đổ nhiên liệu đầu ca" sends no amount — there is no 0-đồng cost to invent.
 */
export function DailyFuelDialog({
  mode = 'check',
  plate,
  saving,
  onSubmit,
  onDeclared,
  onClose,
}: Readonly<{
  mode?: 'check' | 'fill';
  plate: string | null;
  saving: boolean;
  /** Rejects with the server's refusal; the dialog stays open and says why. */
  onSubmit: (input: DailyFuelDeclarationInput) => Promise<unknown>;
  onDeclared: () => void;
  onClose: () => void;
}>) {
  const { t, language } = useLanguage();
  const id = useId();
  const [clientRequestId] = useState(newRequestId);
  const copy = COPY[mode];
  const [outcome, setOutcome] = useState<DailyFuelOutcome | null>(copy.start);
  const [amount, setAmount] = useState('');
  const [liters, setLiters] = useState('');
  const [odometer, setOdometer] = useState('');
  const [note, setNote] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorTaxCode, setVendorTaxCode] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [error, setError] = useState<unknown>(null);
  // The photos of the fill — the meter, the receipt, the station's QR — sent with it for Accounting's check.
  const photos = useFuelPhotos();

  const litersBad = liters.trim() !== '' && !(LITERS.test(litersOf(liters)) && /[1-9]/.test(liters));
  const odometerBad = odometer.trim() !== '' && !(ODOMETER.test(odometer.trim()) && Number(odometer) <= 2_147_483_647);
  const ready = outcome === 'no_fuel' || (outcome === 'fuel_added' && amount.trim() !== '' && !litersBad && !odometerBad);

  const submit = async () => {
    if (!outcome || !ready) return;
    const input: DailyFuelDeclarationInput =
      outcome === 'no_fuel'
        ? { outcome, clientRequestId }
        : {
            outcome,
            amount: amount.trim(),
            liters: liters.trim() === '' ? null : litersOf(liters),
            odometerKm: odometer.trim() === '' ? null : Number(odometer),
            note: note.trim() || null,
            clientRequestId,
            ...(vendorName.trim() ? { vendorName: vendorName.trim() } : {}),
            ...(vendorTaxCode.trim() ? { vendorTaxCode: vendorTaxCode.trim() } : {}),
            ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
            evidence: photos.evidence(),
          };
    setError(null);
    try {
      await onSubmit(input);
      await photos.clear();
      onDeclared();
    } catch (error_) {
      setError(error_);
    }
  };

  const field = (key: string, label: string, control: ReactNode, invalid?: string | null) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {control}
      {invalid ? <p className="mt-1 text-xs text-destructive">{invalid}</p> : null}
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(copy.title)}
      footer={
        <>
          <Button variant="ghost" size="lg" className="h-11" onClick={onClose} disabled={saving}>
            {t('driverCancel')}
          </Button>
          <Button size="lg" className="h-11 flex-1" disabled={!ready || saving || photos.uploading} onClick={() => void submit()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t(copy.submit)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t(copy.intro)}</p>
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t('driverFuelVehicle')}</dt>
            <dd className="font-semibold">{formatPlate(plate) || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('driverFuelDay')}</dt>
            <dd className="font-semibold">{formatCalendarWeekday(todayAsCalendarDay(), language)}</dd>
          </div>
        </dl>

        {mode === 'check' ? (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{t('driverFuelOutcome')}</legend>
            {(['fuel_added', 'no_fuel'] as const).map((option) => (
              <label
                key={option}
                className={cn(
                  'flex h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  outcome === option ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-outcome`}
                  className="size-4 accent-primary"
                  checked={outcome === option}
                  onChange={() => setOutcome(option)}
                />
                {t(option === 'fuel_added' ? 'driverFuelAdded' : 'driverFuelNone')}
              </label>
            ))}
          </fieldset>
        ) : null}

        {outcome === 'fuel_added' ? (
          <div className="space-y-3">
            {field('amount', t('driverFuelAmount'), (
              <MoneyInput id={`${id}-amount`} placeholder={t('driverAmountHint')} value={amount} onChange={setAmount} className="h-11" />
            ))}
            {field('liters', t('driverFuelLiters'), (
              <Input id={`${id}-liters`} inputMode="decimal" value={liters} onChange={(event) => setLiters(event.target.value)} className="h-11" aria-invalid={litersBad} />
            ), litersBad ? t('driverFuelLitersInvalid') : null)}
            {field('odometer', t('driverFuelOdometer'), (
              <Input id={`${id}-odometer`} inputMode="numeric" value={odometer} onChange={(event) => setOdometer(event.target.value)} className="h-11" aria-invalid={odometerBad} />
            ), odometerBad ? t('driverFuelOdometerInvalid') : null)}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('driverPhotosTitle')}</p>
              <FuelPhotoPicker photos={photos} />
            </div>
            <details className="rounded-lg border px-3 py-2">
              <summary className="cursor-pointer py-1 text-sm font-medium">{t('driverReceiptDetails')}</summary>
              <div className="space-y-3 pt-2">
                {field('vendor', t('driverReceiptVendor'), (
                  <Input id={`${id}-vendor`} maxLength={200} value={vendorName} onChange={(event) => setVendorName(event.target.value)} className="h-11" />
                ))}
                {field('tax', t('driverReceiptTaxCode'), (
                  <Input id={`${id}-tax`} inputMode="numeric" maxLength={20} value={vendorTaxCode} onChange={(event) => setVendorTaxCode(event.target.value)} className="h-11" />
                ))}
                {field('invoice', t('driverReceiptNumber'), (
                  <Input id={`${id}-invoice`} maxLength={40} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} className="h-11" />
                ))}
              </div>
            </details>
            {field('note', t('driverFuelNote'), (
              <Input id={`${id}-note`} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} className="h-11" />
            ))}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {t(driverErrorKey(error))}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
