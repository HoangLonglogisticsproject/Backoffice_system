import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * What the reviewer sent back, and the one thing to do about it.
 *
 * ★ THE REASON IS THE POINT. A driver sent back with no reason has nothing
 * to correct; the server requires one and this puts it first. The action
 * takes them to the figures — it never resubmits on their behalf.
 */
export function RejectionNotice({
  title,
  reason,
  actionLabel,
  onAction,
}: Readonly<{ title: string; reason: string | null; actionLabel?: string; onAction?: () => void }>) {
  const { t } = useLanguage();

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="flex items-center gap-1.5 font-medium text-destructive">
        <XCircle className="size-4 shrink-0" aria-hidden />
        {title}
      </p>
      <p className="mt-1.5 text-xs font-medium text-muted-foreground">{t('driverRejectReason')}</p>
      <p className="text-sm whitespace-pre-wrap">{reason ?? t('driverNotSet')}</p>
      {actionLabel && onAction ? (
        <Button variant="outline" size="lg" className="mt-3 h-11 w-full" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
