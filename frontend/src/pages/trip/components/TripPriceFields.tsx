import { MoneyInput } from '@/components/ui/money-input';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TripEntry } from '../entry/useTripEntryForm';

/** The two prices, wired — see `PriceFields`. */
export function TripPriceFields({ entry }: Readonly<{ entry: TripEntry }>) {
  return (
    <PriceFields
      mayView={entry.mayViewPrices}
      mayEdit={entry.mayEditPrices}
      editing={entry.editing}
      sellPrice={entry.form.sellPrice}
      purchasePrice={entry.form.purchasePrice}
      onSellPrice={(plain) => entry.set('sellPrice', plain)}
      onPurchasePrice={(plain) => entry.set('purchasePrice', plain)}
    />
  );
}

/**
 * ★ THE TWO PRICES, DRAWN ONLY FOR SOMEBODY WHO MAY SEE THEM.
 *
 * Not disabled, not blanked — absent. A disabled field would tell a booker
 * that a figure exists and is being withheld, and the server goes to some
 * trouble not to disclose even that: it sends `null` for both to such a
 * caller, so an unpriced trip and a priced one look identical from here.
 *
 * ★ DRAWN BUT DISABLED FOR A READER WHO MAY NOT SET THEM: `trip.price.read`
 * without `trip.price.write` sees the figures and cannot type into either.
 *
 * ★ `MoneyInput`, NOT `type="number"`, on both. The state IS the payload — a
 * plain decimal string — and the grouping comes from `formatWithCommas`. A
 * number input would hand back a value the browser had already put through
 * a float, which is exactly what `NUMERIC(14,2)` on the server exists to
 * prevent.
 */
function PriceFields({
  mayView,
  mayEdit,
  editing,
  sellPrice,
  purchasePrice,
  onSellPrice,
  onPurchasePrice,
}: Readonly<{
  mayView: boolean;
  mayEdit: boolean;
  editing: boolean;
  sellPrice: string;
  purchasePrice: string;
  onSellPrice: (plain: string) => void;
  onPurchasePrice: (plain: string) => void;
}>) {
  const { t } = useLanguage();

  if (!mayView) {
    // Says the trip is saveable without a price, and does NOT say whether
    // this one has one. See the note above.
    return <p className="text-xs text-gray-500">{t('priceRestricted')}</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {!mayEdit && <p className="text-xs text-gray-500 sm:col-span-2">{t('priceReadOnly')}</p>}

      <div className="space-y-2">
        <label htmlFor="trip-purchase-price" className="text-sm font-medium text-gray-700">
          {t('fieldPurchasePrice')}
        </label>
        {/*
          ★ AND THIS ONE IS NOT `required`, WHICH IS THE POINT OF SPLITTING
          THEM. Most runs go on our own lorries and are not bought from
          anybody, so an empty buying price is the ordinary case rather
          than an unfinished form.
        */}
        <MoneyInput
          id="trip-purchase-price"
          value={purchasePrice}
          onChange={onPurchasePrice}
          disabled={!mayEdit}
          aria-describedby="trip-purchase-price-hint"
        />
        <p id="trip-purchase-price-hint" className="text-xs text-gray-500">
          {t('purchasePriceHint')}
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="trip-sell-price" className="text-sm font-medium text-gray-700">
          {t('fieldSellPrice')}
        </label>
        {/*
          ★ `required` ON CREATE ONLY, WHICH IS THE HALF OF THE RULE THE
          BROWSER CAN ENFORCE. A trip is priced when it is booked, so the
          figure is compulsory the first time — the server answers 422
          without it. On an EDIT the field may be emptied, because a price
          typed by mistake has to be removable by whoever may set it, and
          the PATCH route accepts an explicit clear.
        */}
        <MoneyInput
          id="trip-sell-price"
          value={sellPrice}
          onChange={onSellPrice}
          required={!editing && mayEdit}
          disabled={!mayEdit}
          aria-describedby="trip-sell-price-hint"
        />
        <p id="trip-sell-price-hint" className="text-xs text-gray-500">
          {t('sellPriceHint')}
        </p>
      </div>
    </div>
  );
}
