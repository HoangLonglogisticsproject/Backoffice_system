import type { ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * One labelled fact: an icon, what it is, and what it says. Absent values say
 * "not set" in words rather than leaving a gap the eye reads as a bug.
 */
export function FactRow({
  icon,
  label,
  value,
  emphasis = false,
}: Readonly<{ icon: ReactNode; label: string; value: string | null; emphasis?: boolean }>) {
  const { t } = useLanguage();

  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={
            value
              ? `${emphasis ? 'text-base font-medium' : 'text-sm'} whitespace-pre-wrap`
              : 'text-sm text-muted-foreground'
          }
        >
          {value ?? t('driverNotSet')}
        </p>
      </div>
    </div>
  );
}
