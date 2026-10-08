import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FuelCandidate } from '@/types/fuel';
import type { Language } from '@/types/translate';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';

const summaryOf = (candidate: FuelCandidate, language: Language) =>
  [
    `${formatMoney(candidate.amount)} đ`,
    candidate.businessDate ? formatCalendarDay(candidate.businessDate, language) : null,
    candidate.vehicle ? formatPlate(candidate.vehicle.plate) : null,
  ]
    .filter(Boolean)
    .join(' · ');

interface FuelAttachDialogProps {
  target: FuelCandidate;
  others: FuelCandidate[];
  imageCount: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (acknowledged: string[]) => void;
}

/**
 * The last look before a receipt goes onto a cost. ★ IT SAYS WHAT WILL NOT
 * HAPPEN: no new cost, no change to the amount — the money row stays as it was.
 */
export function FuelAttachDialog({ target, others, imageCount, pending, onCancel, onConfirm }: Readonly<FuelAttachDialogProps>) {
  const { t, language } = useLanguage();
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const allSeen = others.every((other) => seen.has(other.fuelTransactionId as string));
  const toggle = (id: string) =>
    setSeen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={t('fuelAttachTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button type="button" disabled={!allSeen || pending} onClick={() => onConfirm([...seen])}>
            {t('fuelAttachConfirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          {t(target.backing.ledger === 'vehicle' ? 'fuelLedgerVehicle' : 'fuelLedgerTrip')}: <strong>{summaryOf(target, language)}</strong>
        </p>
        <p className="text-gray-600">{`${imageCount} ${t('fuelImageCount')} · ${t('fuelAttachNoCreate')}`}</p>
        {others.length > 0 ? (
          <fieldset className="space-y-2 rounded-lg bg-amber-50 p-3">
            <legend className="text-sm font-medium text-amber-900">{t('fuelAlsoOnOther')}</legend>
            {others.map((other) => (
              <label key={other.fuelTransactionId} className="flex items-start gap-2 text-amber-900">
                <input
                  type="checkbox"
                  checked={seen.has(other.fuelTransactionId as string)}
                  onChange={() => toggle(other.fuelTransactionId as string)}
                />
                <span>
                  {summaryOf(other, language)} — {t('fuelConfirmDifferent')}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
    </Modal>
  );
}
