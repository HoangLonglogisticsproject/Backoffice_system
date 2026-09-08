import type { Language } from '@/types/translate';

/**
 * A distance the server measured, made readable.
 *
 * ★ FORMATS, NEVER MEASURES. The metres come from the backend's own haversine
 * (`distance_m`) or from the handset's accuracy estimate (`accuracy_m`); this
 * only chooses a unit and drops the float noise. Whole metres below a
 * kilometre, one decimal above it — `42 m`, `1.2 km` — through `Intl`, so the
 * decimal mark follows the language like every other number on the screen.
 */
export function formatDistance(meters: number, language: Language): string {
  const locale = language === 'vi' ? 'vi-VN' : 'en-US';
  if (meters >= 1000) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'kilometer',
      maximumFractionDigits: 1,
    }).format(meters / 1000);
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'meter',
    maximumFractionDigits: 0,
    // Only 999.5–999.99 ever reaches four digits here, and `1.000 m` in
    // Vietnamese would read as one metre.
    useGrouping: false,
  }).format(meters);
}
