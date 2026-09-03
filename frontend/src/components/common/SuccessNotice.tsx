import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * The result of an action the user just took, said once above the list.
 *
 * ★ `<output>`, NOT a div wearing `role="status"`. The element carries that
 * role implicitly and is the HTML for exactly this. Assistive technology
 * sees a polite live region either way; `flex` overrides the inline default.
 */
export function SuccessNotice({
  children,
  onDismiss,
}: Readonly<{ children: ReactNode; onDismiss: () => void }>) {
  const { t } = useLanguage();
  return (
    <output className="flex w-full items-center justify-between gap-4 rounded-xl border border-green-200 bg-green-50 px-5 py-3 text-sm text-green-800">
      <span>{children}</span>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        {t('dismiss')}
      </Button>
    </output>
  );
}
