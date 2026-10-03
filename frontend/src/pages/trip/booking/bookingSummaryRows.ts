import type { useLanguage } from '@/contexts/LanguageContext';
import { formatCalendarDay } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import type { FormState } from '../entry/tripEntryModel';
import type { ChosenPlace } from '../entry/tripEntryPlaces';

type Translate = ReturnType<typeof useLanguage>['t'];
type Language = ReturnType<typeof useLanguage>['language'];

/** One line of the summary: what it is, and what the form says. */
interface SummaryRow {
  key: string;
  label: string;
  value: string;
}

/** The first line of a typed block — an address cell holds a company, a street and a phone on four lines. */
const firstLine = (text: string): string => text.trim().split('\n')[0]?.trim() ?? '';

/** An end as the summary names it: the chosen place, or the first line of the address typed by hand. */
const endLabel = (place: ChosenPlace | null, typed: string): string => place?.name ?? firstLine(typed);

/**
 * ★ THE FORM, READ BACK — NOTHING OF ITS OWN. Every value comes from the same
 * `TripEntry` the sections type into — the times as typed on the business
 * clock, the money as the plain decimal string the server is sent — so the
 * summary can never disagree with the booking it summarises. Both times read
 * "day · hour". A row is drawn only once it has something to say; prices only
 * for a caller who may see them.
 */
export const summaryRows = (
  form: FormState,
  places: { pickup: ChosenPlace | null; delivery: ChosenPlace | null },
  customerName: string | null,
  mayViewPrices: boolean,
  t: Translate,
  language: Language,
): SummaryRow[] => {
  const pickupDay = form.scheduledOn ? formatCalendarDay(form.scheduledOn, language) : '';
  // The `datetime-local` value, already on the business clock: "YYYY-MM-DDTHH:mm".
  const [deliveryDay, deliveryTime] = form.deliveryAt.split('T');
  const rows: SummaryRow[] = [
    { key: 'customer', label: t('fieldCustomer'), value: customerName ?? '' },
    { key: 'cargo', label: t('fieldCargo'), value: firstLine(form.cargoInfo) },
    { key: 'pickup', label: t('colPickup'), value: endLabel(places.pickup, form.pickupAddress) },
    { key: 'delivery', label: t('colDelivery'), value: endLabel(places.delivery, form.deliveryAddress) },
    {
      key: 'pickupAt',
      label: t('bookingSummaryPickupTime'),
      value: pickupDay && `${pickupDay} · ${form.pickupTime || t('driverNoPickupTime')}`,
    },
    {
      key: 'deliveryAt',
      label: t('bookingSummaryDeliveryTime'),
      value: deliveryDay && deliveryTime ? `${formatCalendarDay(deliveryDay, language)} · ${deliveryTime}` : '',
    },
  ];
  if (mayViewPrices) {
    rows.push(
      { key: 'purchase', label: t('bookingSummaryPurchase'), value: form.purchasePrice && formatMoney(form.purchasePrice) },
      { key: 'sell', label: t('bookingSummarySell'), value: form.sellPrice && formatMoney(form.sellPrice) },
    );
  }
  return rows.filter((row) => row.value !== '');
};
