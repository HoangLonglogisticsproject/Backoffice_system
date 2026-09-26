import type { ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { driverErrorKey, isFinalRefusal } from '@/utils/driverErrors';

/**
 * A read that failed: one sentence in the driver's words, and what to do.
 *
 * ★ NEVER A STATUS CODE OR A SERVER MESSAGE — `driverErrorKey` words every
 * failure, and an unknown one as "try again, then tell the office".
 *
 * ★ NO RETRY BUTTON FOR AN ANSWER THAT WILL NOT CHANGE. A 403 or 404 is the
 * server's decision, not a hiccup; a button that cannot succeed teaches the
 * driver to tap it. `children` is the way out the screen offers instead.
 */
export function DriverLoadError({
  error,
  onRetry,
  children,
}: Readonly<{ error: unknown; onRetry: () => void; children?: ReactNode }>) {
  const { t } = useLanguage();

  return (
    <Card>
      <CardContent className="space-y-4 py-4 text-center">
        <p role="alert" className="text-sm">
          {t(driverErrorKey(error))}
        </p>
        <div className="flex flex-col gap-2">
          {isFinalRefusal(error) ? null : (
            <Button size="lg" className="h-11 w-full" onClick={onRetry}>
              <RotateCw aria-hidden />
              {t('driverRetry')}
            </Button>
          )}
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
