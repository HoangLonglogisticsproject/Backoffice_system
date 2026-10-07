import { History, Package, Truck, Wallet } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import type { TripBoardRow } from '@/types/tripBoard';
import { formatPlate } from '@/utils/format';
import { formatTimeOnDay } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { Prose, Unset } from '../components/TripCells';
import { TripCostCell } from '../components/TripCostCell';
import { crewSignal } from './bookingPresentation';
import { Field, FieldSection, Section } from './DetailSection';

/**
 * The facts of one booking below the route, one section per question — for
 * whom, who drives, for how much, and by whom it was entered. Small components
 * sharing a file, each owning one question and reading nothing the others need.
 * The route is its own file (`BookingRouteSection`): it is the panel's lead.
 */

type Props = Readonly<{ trip: TripBoardRow }>;

/** Whose goods, what they are, and anything the office wrote down — prose, so each label sits above its value. */
export function BookingCustomerSection({ trip }: Props) {
  const { t } = useLanguage();
  return (
    <FieldSection title={t('bookingSectionCustomer')} icon={Package}>
      <Field label={t('colCustomer')} stacked>
        {trip.customer?.name ?? <Unset />}
      </Field>
      <Field label={t('colCargo')} stacked>
        <Prose value={trip.cargoInfo} />
      </Field>
      <Field label={t('colNote')} stacked>
        <Prose value={trip.note} />
      </Field>
    </FieldSection>
  );
}

/**
 * Every ACTIVE pair on the run (ADR-0004), each as the lorry over its driver,
 * and whether that driver has started. A trip with none says so; one booked
 * with a lorry before dispatch became a pair says that instead, so Operations
 * knows to dispatch it again.
 */
export function BookingCrewSection({ trip }: Props) {
  const { t, language } = useLanguage();
  const signal = crewSignal(trip);
  return (
    <Section title={t('bookingSectionCrew')} icon={Truck}>
      {signal === 'unassigned' && <p className="text-sm text-gray-500">{t('dispatchEmpty')}</p>}
      {signal === 'legacyVehicle' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('dispatchLegacyVehicle')}
        </p>
      )}
      {signal === 'assigned' && (
        <ul className="space-y-3">
          {trip.assignments.map((turn) => (
            <li key={turn.id} className="flex gap-3 text-sm">
              <Truck className="mt-0.5 size-4 shrink-0 text-gray-400" aria-hidden="true" />
              <div className="min-w-0">
                {turn.vehicle ? (
                  <p className="font-semibold text-gray-900">{formatPlate(turn.vehicle.plate)}</p>
                ) : (
                  <p className="font-medium text-amber-700">{t('dispatchMissingVehicle')}</p>
                )}
                <p className="text-gray-700">{turn.driver.displayName}</p>
                <p className="flex flex-wrap gap-x-2 text-xs text-gray-400">
                  <span className="tabular-nums">{formatTimeOnDay(turn.assignedAt, language)}</span>
                  {turn.started && <span className="font-medium text-blue-700">{t('bookingDriverStarted')}</span>}
                </p>
              </div>
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
    value ? <span className="font-medium tabular-nums">{formatMoney(value)}</span> : <Unset />;
  return (
    <FieldSection title={t('bookingSectionPricing')} icon={Wallet}>
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
          <TripCostCell summary={trip.costSummary} onOpen={onCosts} className="-mx-1 text-left" />
        </Field>
      )}
    </FieldSection>
  );
}

/** Who entered the booking, and when the row itself last changed. */
export function BookingMetaSection({ trip }: Props) {
  const { t, language } = useLanguage();
  return (
    <FieldSection title={t('bookingSectionMeta')} icon={History}>
      <Field label={t('colCreatedBy')}>{trip.createdByUser.displayName}</Field>
      <Field label={t('colCreatedAt')}>{formatTimeOnDay(trip.createdAt, language)}</Field>
      <Field label={t('colUpdatedAt')}>{formatTimeOnDay(trip.updatedAt, language)}</Field>
    </FieldSection>
  );
}
