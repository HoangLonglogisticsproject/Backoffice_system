import type { Language } from '@/types/translate';

/**
 * Dates rendered in the language the interface is speaking.
 *
 * ★ NOT THE BROWSER'S LOCALE. `toLocaleDateString()` with no argument reads the
 * browser, which is a different setting from the one the user picked in this
 * app — so a Vietnamese interface on an en-US machine renders `8/21/2026` in
 * the middle of Vietnamese text. The language the user chose is the one that
 * should decide.
 */
const LOCALES: Record<Language, string> = {
  vi: 'vi-VN',
  en: 'en-US',
};

/** An ISO timestamp from the API as a date, in `language`. */
export function formatDate(iso: string, language: Language): string {
  const date = new Date(iso);
  // A malformed timestamp is the server's problem to fix, not a reason to throw
  // inside a table cell — show the raw value so it is visibly wrong.
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(LOCALES[language]);
}

/** The same, with the time of day — for queues where ordering matters. */
export function formatDateTime(iso: string, language: Language): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(LOCALES[language]);
}
