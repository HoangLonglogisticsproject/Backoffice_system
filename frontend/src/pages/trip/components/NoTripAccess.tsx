import { useLanguage } from '@/contexts/LanguageContext';

/**
 * ★ THE SCREEN ITSELF SAYS NO, not only the menu. A caller outside the
 * booking functions holds no `trip.read`; the server answers 403 to every
 * trip read, so drawing a board or a catalogue and letting it fail would be a
 * screen that lies about what it is for. One component for the three trip
 * screens, so they refuse in the same words.
 */
export function NoTripAccess() {
  const { t } = useLanguage();
  return (
    <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      {t('tripNoPermission')}
    </p>
  );
}
