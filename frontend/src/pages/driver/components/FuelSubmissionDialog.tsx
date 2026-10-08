import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFuelPhotos, useMyFuelSubmission, useResubmitFuel, type FuelPhotos } from '@/hooks/driver/fuel';
import type { DriverFuelSubmissionDetail } from '@/types/fuel';
import { driverErrorKey } from '@/utils/driverErrors';
import { DriverLoadError } from './DriverLoadError';
import { FillSummary } from './FuelFillSummary';
import { FuelPhotoPicker } from './FuelPhotoPicker';

/**
 * One of the driver's own fills: what was recorded, where Accounting's check
 * stands and why, the photos they sent — and, only when Accounting asked
 * ("Cần bổ sung"), the way to answer: more photos, a station or an invoice
 * number not given before, a word back. What was already recorded is shown,
 * never editable: a wrong amount is Accounting's to refuse, then a new fill.
 */
export function FuelSubmissionDialog({ id, onClose }: Readonly<{ id: string; onClose: () => void }>) {
  const { t } = useLanguage();
  const { data: fill, error, refetch } = useMyFuelSubmission(id);
  const photos = useFuelPhotos();
  const resubmit = useResubmitFuel();
  const [answer, setAnswer] = useState<Answer>({ vendorName: '', documentNumber: '', note: '' });
  const asked = fill?.status === 'needs_info';
  const typed = (key: keyof typeof answer) => (answer[key].trim() ? { [key]: answer[key].trim() } : {});

  const send = async () => {
    await resubmit.mutateAsync({
      id,
      input: { ...typed('vendorName'), ...typed('documentNumber'), ...typed('note'), evidence: photos.evidence() },
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
            <Button size="lg" className="h-11 flex-1" disabled={resubmit.isPending || photos.uploading} onClick={() => void send().catch(() => undefined)}>
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
          <FillSummary fill={fill} />
          {asked ? <AnswerForm fill={fill} photos={photos} answer={answer} onChange={setAnswer} error={resubmit.error} /> : null}
        </div>
      ) : null}
    </Modal>
  );
}

type Answer = { vendorName: string; documentNumber: string; note: string };

/**
 * The answer to "Cần bổ sung": more photos, a station or an invoice number
 * only where none was recorded (a fact is added once, never rewritten), and a
 * word back to Accounting.
 */
function AnswerForm({
  fill,
  photos,
  answer,
  onChange,
  error,
}: Readonly<{
  fill: DriverFuelSubmissionDetail;
  photos: FuelPhotos;
  answer: Answer;
  onChange: (update: (current: Answer) => Answer) => void;
  error: unknown;
}>) {
  const { t } = useLanguage();
  const field = useId();
  const text = (key: keyof Answer, label: string, maxLength: number) => (
    <div>
      <label htmlFor={`${field}-${key}`} className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        id={`${field}-${key}`}
        className="h-11"
        maxLength={maxLength}
        value={answer[key]}
        onChange={(event) => onChange((current) => ({ ...current, [key]: event.target.value }))}
      />
    </div>
  );
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="font-medium">{t('driverFuelSupplement')}</p>
      <FuelPhotoPicker photos={photos} />
      {fill.vendor?.name ? null : text('vendorName', t('driverReceiptVendor'), 200)}
      {fill.document?.number ? null : text('documentNumber', t('driverReceiptNumber'), 40)}
      {text('note', t('driverFuelReplyNote'), 1000)}
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
          {t(driverErrorKey(error))}
        </p>
      ) : null}
    </div>
  );
}
