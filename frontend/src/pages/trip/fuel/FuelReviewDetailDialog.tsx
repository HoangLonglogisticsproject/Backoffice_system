import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDecideFuelReview, useFuelReview } from '@/hooks/trip/useFuelReviews';
import type { FuelReviewAction, FuelReviewStatus } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';
import { cn } from '@/utils/cn';
import { formatPlate } from '@/utils/format';
import { formatMoney } from '@/utils/format/money';
import { FUEL_STATUS_LABEL, FUEL_STATUS_TONE } from '@/utils/fuelStatus';
import { FuelReviewFill } from './FuelReviewFill';

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
 * One driver's fill, as Accounting decides on it (`FuelReviewFill` shows it). Only the moves its state
 * allows are offered; asking for more or refusing needs a note the driver reads, and paying may carry
 * the transfer reference.
 */
export function FuelReviewDetailDialog({ id, onClose }: Readonly<{ id: string; onClose: () => void }>) {
  const { t } = useLanguage();
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

          <FuelReviewFill detail={data} />

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

