import { useLanguage } from '@/contexts/LanguageContext';
import { formatDateTime } from '@/utils/format/datetime';

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

/** One end of a trip: where, who, and when. */
export function Leg({
  address,
  contact,
  at,
}: Readonly<{ address: string | null; contact: string | null; at: string | null }>) {
  const { language } = useLanguage();

  if (!address && !contact && !at) return <Unset />;

  return (
    <div className="max-w-[22rem] space-y-1 text-sm">
      {address && <span className="block whitespace-pre-line text-gray-900">{address}</span>}
      {contact && <span className="block whitespace-pre-line text-gray-500">{contact}</span>}
      {/*
        A full date and time, not just the hour: delivery routinely falls on a
        later day than the trip's own date, and showing `09:00` alone would
        quietly claim it happens the same day.
      */}
      {at && <span className="block font-medium text-blue-700">{formatDateTime(at, language)}</span>}
    </div>
  );
}
