import { useLanguage } from '@/contexts/LanguageContext';

/** Cells Lịch xe and Lịch sử chuyến draw the same way. */

/** A field the row genuinely has no value for — shown, not left blank. */
export function Unset() {
  const { t } = useLanguage();
  return <span className="text-gray-400">{t('notSelected')}</span>;
}

/**
 * A multi-line cell from the workbook.
 *
 * `whitespace-pre-line` keeps the line breaks the source data has — an address
 * cell holds a company, a street, a ward and a phone on four lines — and the
 * width cap stops one long address from pushing every other column off screen.
 */
export function Prose({ value }: Readonly<{ value: string | null }>) {
  if (!value) return <Unset />;
  return (
    <span className="block max-w-[22rem] whitespace-pre-line text-gray-700">{value}</span>
  );
}
