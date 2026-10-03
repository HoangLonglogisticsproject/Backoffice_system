import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import type { TripCustomer, TripEntryMode, TripScheduleWithRefs, TripVehicle } from '@/types/trip';
import { useTripEntryForm } from '../entry/useTripEntryForm';
import { CrewFields } from './TripCrewFields';
import {
  CargoField,
  CustomerField,
  DeliveryAtField,
  NoteField,
  PickupDateField,
  PickupHourField,
} from './TripEntryFields';
import { PlaceDialog, TripEnd, TripLocationReadiness } from './TripLocationFields';
import { TripPriceFields } from './TripPriceFields';
import { TRIP_STATUS_STYLES } from './tripStatus';

interface TripFormModalProps {
  isOpen: boolean;
  /** Absent means "add". Present means "correct this row" — GLOBAL only. */
  trip?: TripScheduleWithRefs | null;
  /**
   * ★ WHY A NEW TRIP IS BEING ENTERED — set by the button that opened this
   * form, never guessed from the dates typed into it. `operational` (Lịch xe,
   * "Thêm chuyến") books work still to run; `historical` (Lịch sử chuyến,
   * "Nhập chuyến cũ") records a run that already happened, so a past day is
   * accepted. Nothing else differs — one form, one set of integrity rules.
   * Ignored when correcting a row.
   */
  mode?: TripEntryMode;
  customers: TripCustomer[];
  /**
   * The active lorries, for the crew rows below.
   *
   * ★ STILL NO LORRY FIELD ON THE TRIP (ADR-0004). These feed
   * "Phương tiện điều độ", where each row is one ASSIGNMENT — a lorry AND its
   * driver — and every row is sent to the dispatch endpoint after the trip
   * exists. Nothing here reads or writes `trip_schedules.vehicle_id`.
   */
  vehicles: TripVehicle[];
  /**
   * May the caller dispatch? `trip.create` and `trip.write` are separate
   * permissions and the dispatch endpoint demands the second, so somebody who
   * may book a trip but not crew one is offered no rows to fill in rather than
   * a section that answers 403 on save.
   */
  mayDispatch: boolean;
  /**
   * Has the customer catalogue read come back?
   *
   * Needed only to tell "this customer is archived" from "the list has not
   * loaded yet" — the two look identical from an empty options array, and
   * labelling an active customer as archived for the first few hundred
   * milliseconds would be a statement that is simply untrue.
   */
  cataloguesLoaded: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** A new catalogue row was added from inside the form; reload the lists. */
  onCatalogueChanged: () => void;
}

/**
 * Recording a past run ("Nhập chuyến cũ") or correcting a row — a narrow
 * dialog, one column of the trip's fields.
 *
 * ★ THE PRESENTATION ONLY. The state, the rules and the save are
 * `useTripEntryForm`, shared with the booking workspace that "Thêm chuyến"
 * opens (`OperationalBookingDialog`); the fields are `TripEntryFields`.
 */
export function TripFormModal({
  isOpen,
  trip = null,
  mode = 'operational',
  customers,
  vehicles,
  mayDispatch,
  cataloguesLoaded,
  onClose,
  onSaved,
  onCatalogueChanged,
}: Readonly<TripFormModalProps>) {
  const { t } = useLanguage();
  const entry = useTripEntryForm({ isOpen, trip, mode, mayDispatch, onClose, onSaved });
  const { editing, busy, priceOnly, statusLocked } = entry;
  const formId = 'trip-form';

  return (
    <Modal
      isOpen={isOpen}
      onClose={entry.close}
      title={formTitle(editing, mode, t)}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" type="button" onClick={entry.close} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={entry.submit} className="space-y-4">
        {/*
          ★ EVERYTHING THAT IS NOT A PRICE SITS IN A `fieldset`, disabled for a
          price-only editor. A disabled control is skipped by the browser's
          constraint validation, so the compulsory instants do not block a save
          that will not send them anyway.
        */}
        {priceOnly && <p className="text-xs text-gray-500">{t('priceOnlyEdit')}</p>}
        {!editing && mode === 'historical' && <p className="text-xs text-gray-500">{t('importTripHint')}</p>}
        <fieldset disabled={priceOnly} className="min-w-0 space-y-4">
        <div className={cn('grid gap-4', statusLocked && 'sm:grid-cols-2')}>
          {/* ★ A FROZEN DISPLAY, NEVER AN EDITOR — and only where it is frozen:
              a trip recorded after it ran, or a finished one corrected from
              Lịch sử chuyến. A booking on Lịch xe shows no status field at all;
              it moves by named actions, and its status is on the panel. */}
          {statusLocked && (
            <div className="space-y-2">
              <label htmlFor="trip-status" className="text-sm font-medium text-gray-700">
                {t('fieldStatus')}
              </label>
              <select
                id="trip-status"
                value="finished"
                disabled
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="finished">{t(TRIP_STATUS_STYLES.finished.label)}</option>
              </select>
            </div>
          )}

          <CustomerField
            entry={entry}
            customers={customers}
            cataloguesLoaded={cataloguesLoaded}
            onCatalogueChanged={onCatalogueChanged}
          />
        </div>

        <p className="text-xs text-gray-500">{t('catalogueHint')}</p>

        <CargoField entry={entry} />
        </fieldset>
        {/* The two prices — absent for a viewer who may not see them (`PriceFields`). */}
        <TripPriceFields entry={entry} />

        <fieldset disabled={priceOnly} className="min-w-0 space-y-4">
        {/*
          ★ EACH END IS ONE COLUMN: where, who — and WHEN. The instant belongs
          to its end, so a dispatcher reads "Điểm lấy hàng … Thời gian lấy
          hàng" top to bottom, and the delivery column says the same of its own.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <TripEnd entry={entry} end="pickup" />
            {/* The DATE is the booking's; the hour is known when it is known. */}
            <div className="grid grid-cols-2 gap-3">
              <PickupDateField entry={entry} />
              <PickupHourField entry={entry} />
            </div>
          </div>
          <div className="min-w-0 space-y-4">
            <TripEnd entry={entry} end="delivery" />
            <DeliveryAtField entry={entry} />
          </div>

          <TripLocationReadiness entry={entry} />
        </div>

        {/* ★ THE CREW, TYPED WITH THE TRIP — AND STILL ONE ASSIGNMENT PER PAIR.
            Only when CREATING: correcting an existing trip's crew is the
            dispatch panel's job, where a change can be ended with a reason and
            keep its history. */}
        {!editing && mayDispatch && <CrewFields entry={entry} vehicles={vehicles} />}

        <NoteField entry={entry} />
        </fieldset>

        {entry.error && (
          <p role="alert" className="text-sm text-red-600">
            {entry.error}
          </p>
        )}
      </form>

      <PlaceDialog entry={entry} />
    </Modal>
  );
}

/** The dialog's name: the correction, or which of the two ways a trip is entered. */
const formTitle = (
  editing: boolean,
  mode: TripEntryMode,
  t: ReturnType<typeof useLanguage>['t'],
): string => {
  if (editing) return t('editTrip');
  return mode === 'historical' ? t('importTrip') : t('createTripTitle');
};
