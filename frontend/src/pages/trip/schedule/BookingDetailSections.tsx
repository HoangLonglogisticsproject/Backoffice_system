import { Truck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import type { TripBoardRow } from '@/types/tripBoard';
import { formatPlate } from '@/utils/format';
import { formatDateTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { Leg, Prose, Unset } from '../components/TripCells';
import { TripCostCell } from '../components/TripCostCell';
import { crewSignal } from './bookingPresentation';
import { Field, FieldSection, Section } from './DetailSection';

/**
 * The facts of one booking, one section per question — where, for whom, who,
 * for how much, and by whom it was entered. Small components sharing a file,
 * each owning one question and reading nothing the others need.
 */

type Props = Readonly<{ trip: TripBoardRow }>;

/** Where from and where to — each end's place, address, contact and booked instant. */
export function BookingRouteSection({ trip }: Props) {
  const { t } = useLanguage();
  return (
    <FieldSection title={t('bookingSectionRoute')}>
      <Field label={t('colPickup')}>
        {trip.pickupLocation && <p className="font-medium text-gray-900">{trip.pickupLocation.name}</p>}
        <Leg address={trip.pickupAddress} contact={trip.pickupContact} at={trip.pickupAt} />
      </Field>
      <Field label={t('colDelivery')}>
        {trip.deliveryLocation && <p className="font-medium text-gray-900">{trip.deliveryLocation.name}</p>}
        <Leg address={trip.deliveryAddress} contact={trip.deliveryContact} at={trip.deliveryAt} />
      </Field>
    </FieldSection>
  );
}

/** Whose goods, what they are, and anything the office wrote down. */
export function BookingCustomerSection({ trip }: Props) {
  const { t } = useLanguage();
  return (
    <FieldSection title={t('bookingSectionCustomer')}>
      <Field label={t('colCustomer')}>{trip.customer?.name ?? <Unset />}</Field>
      <Field label={t('colCargo')}>
        <Prose value={trip.cargoInfo} />
      </Field>
      <Field label={t('colNote')}>
        <Prose value={trip.note} />
      </Field>
    </FieldSection>
  );
}

/**
 * Every ACTIVE pair on the run (ADR-0004), and whether its driver has started.
 * A trip with none says so; one booked with a lorry before dispatch became a
 * pair says that instead, so Operations knows to dispatch it again.
 */
export function BookingCrewSection({ trip }: Props) {
  const { t, language } = useLanguage();
  const signal = crewSignal(trip);
  return (
    <Section title={t('bookingSectionCrew')}>
      {signal === 'unassigned' && <p className="text-sm text-gray-500">{t('dispatchEmpty')}</p>}
      {signal === 'legacyVehicle' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('dispatchLegacyVehicle')}
        </p>
      )}
      {signal === 'assigned' && (
        <ul className="space-y-2">
          {trip.assignments.map((turn) => (
            <li key={turn.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5 font-medium text-gray-900">
                <Truck className="h-4 w-4 text-gray-500" aria-hidden="true" />
                {turn.vehicle ? (
                  formatPlate(turn.vehicle.plate)
                ) : (
                  <span className="text-amber-700">{t('dispatchMissingVehicle')}</span>
                )}
              </span>
              <span className="text-gray-700">{turn.driver.displayName}</span>
              <span className="text-xs text-gray-400">{formatDateTime(turn.assignedAt, language)}</span>
              {turn.started && <span className="text-xs font-medium text-blue-700">{t('bookingDriverStarted')}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * ★ ABSENT, NOT EMPTY, FOR A VIEWER WHO MAY NOT SEE THE FIGURES. The server
 * sends `null` prices to a caller without `trip.price.read` and no cost summary
 * without `cost.read`, so a rendered "—" would claim the trip is unpriced.
 * Prices formatted, never parsed — they are `NUMERIC(14,2)` carried as text.
 */
export function BookingPricingSection({ trip, onCosts }: Readonly<{ trip: TripBoardRow; onCosts: () => void }>) {
  const { t } = useLanguage();
  const { can } = useSession();
  const mayPrice = can('trip.price.read');
  const mayCost = can('cost.read');
  if (!mayPrice && !mayCost) return null;

  const money = (value: string | null) =>
    value ? <span className="tabular-nums">{formatMoney(value)}</span> : <Unset />;
  return (
    <FieldSection title={t('bookingSectionPricing')}>
      {mayPrice && <Field label={t('colSellPrice')}>{money(trip.sellPrice)}</Field>}
      {mayPrice && <Field label={t('colPurchasePrice')}>{money(trip.purchasePrice)}</Field>}
      {mayCost && (
        <Field
          label={
            // What the total counts, said once — it is the cost dialog's figure,
            // so it may include a driver's lines still awaiting review.
            <span title={t('tripCostHelp')} className="cursor-help underline decoration-dotted underline-offset-4">
              {t('tripCost')}
            </span>
          }
        >
          <TripCostCell summary={trip.costSummary} onOpen={onCosts} />
        </Field>
      )}
    </FieldSection>
  );
}

/** Who entered the booking, and when the row itself last changed. */
export function BookingMetaSection({ trip }: Props) {
  const { t, language } = useLanguage();
  return (
    <FieldSection title={t('bookingSectionMeta')}>
      <Field label={t('colCreatedBy')}>{trip.createdByUser.displayName}</Field>
      <Field label={t('colCreatedAt')}>{formatDateTime(trip.createdAt, language)}</Field>
      <Field label={t('colUpdatedAt')}>{formatDateTime(trip.updatedAt, language)}</Field>
    </FieldSection>
  );
}
