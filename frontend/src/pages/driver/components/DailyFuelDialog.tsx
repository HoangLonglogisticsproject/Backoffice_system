import { useId, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DailyFuelDeclarationInput, DailyFuelOutcome } from '@/types/driver';
import { cn } from '@/utils/cn';
import { newRequestId } from '@/utils/driverDraft';
import { driverErrorKey } from '@/utils/driverErrors';
import { formatPlate } from '@/utils/format';
import { formatCalendarWeekday, todayAsCalendarDay } from '@/utils/format/datetime';

/** Liters as the server takes them: above 0, at most 2 decimals. A comma is read as the point. */
const LITERS = /^\d{1,8}(\.\d{1,2})?$/;
const ODOMETER = /^\d{1,10}$/;
const litersOf = (text: string): string => text.trim().replace(',', '.');

/**
 * "Khai báo nhiên liệu đầu ngày" — opened when the server holds the day's first
 * milestone for the lorry's fuel check (`FUEL_DECLARATION_REQUIRED`).
 *
 * ★ THE LORRY AND THE DAY ARE SHOWN, NEVER SENT. The server takes both from the
 * assignment and its own clock; the day here is the handset's reading of the
 * same Asia/Ho_Chi_Minh calendar, for the driver's eyes only.
 *
 * ★ ONE KEY PER OPENING. A retry after a dropped connection reuses it, so the
 * fill is written once; the parent mounts a fresh dialog each time it asks.
 * "No fuel today" sends no amount — there is no 0-đồng cost to invent.
 */
export function DailyFuelDialog({
  plate,
  saving,
  onSubmit,
  onDeclared,
  onClose,
}: Readonly<{
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
  const [outcome, setOutcome] = useState<DailyFuelOutcome | null>(null);
  const [amount, setAmount] = useState('');
  const [liters, setLiters] = useState('');
  const [odometer, setOdometer] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);

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
          };
    setError(null);
    try {
      await onSubmit(input);
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
      title={t('driverFuelTitle')}
      footer={
        <>
          <Button variant="ghost" size="lg" className="h-11" onClick={onClose} disabled={saving}>
            {t('driverCancel')}
          </Button>
          <Button size="lg" className="h-11 flex-1" disabled={!ready || saving} onClick={() => void submit()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('driverFuelSubmit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('driverFuelIntro')}</p>
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
