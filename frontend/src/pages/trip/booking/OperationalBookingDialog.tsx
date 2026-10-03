import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TripCustomer, TripVehicle } from '@/types/trip';
import { PlaceDialog } from '../components/TripLocationFields';
import { useTripEntryForm } from '../entry/useTripEntryForm';
import { BookingCommercialSection } from './BookingCommercialSection';
import { BookingCrewSection } from './BookingCrewSection';
import { BookingCustomerSection } from './BookingCustomerSection';
import { BookingRouteSection } from './BookingRouteSection';
import { BookingSummary } from './BookingSummary';
import { BookingTimeSection } from './BookingTimeSection';

const FORM_ID = 'booking-form';

/**
 * "Thêm chuyến" — the booking workspace: the form in numbered sections on
 * the left, the booking read back on the right, the actions pinned beneath.
 *
 * ★ A NEW PRESENTATION OF THE SAME FORM. State, rules, payload and save are
 * `useTripEntryForm` with the `operational` intent — exactly what
 * `TripFormModal` drew for this button before — and every field is the shared
 * one from `TripEntryFields`, with its id, label and rule. Same input, same
 * `POST /trip-schedules`.
 *
 * On a phone the dialog is the whole screen and one column; the footer sits
 * outside the scrolling body, so it never covers a field.
 */
export function OperationalBookingDialog({
  isOpen,
  customers,
  vehicles,
  mayDispatch,
  cataloguesLoaded,
  onClose,
  onSaved,
  onCatalogueChanged,
}: Readonly<{
  isOpen: boolean;
  customers: TripCustomer[];
  /** The active lorries, for the optional crew rows. */
  vehicles: TripVehicle[];
  /** Crewing on create is `dispatch.write`, which `trip.create` does not imply. */
  mayDispatch: boolean;
  cataloguesLoaded: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCatalogueChanged: () => void;
}>) {
  const { t } = useLanguage();
  const entry = useTripEntryForm({ isOpen, trip: null, mode: 'operational', mayDispatch, onClose, onSaved });
  const { busy } = entry;

  return (
    <Modal
      isOpen={isOpen}
      onClose={entry.close}
      title={t('createTripTitle')}
      className="h-dvh max-h-dvh max-w-none rounded-none sm:h-auto sm:max-h-[92vh] sm:w-[calc(100%-2rem)] sm:max-w-[1120px] sm:rounded-xl"
      bodyClassName="bg-gray-50 p-0"
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-1">
            {entry.error && (
              <p role="alert" className="text-sm text-red-600">
                {entry.error}
              </p>
            )}
            <p className="text-xs text-gray-500">{t('bookingCreateHelper')}</p>
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="outline" type="button" onClick={entry.close} disabled={busy} className="h-9 px-4">
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              disabled={busy}
              aria-busy={busy}
              className="h-9 bg-blue-600 px-4 text-white hover:bg-blue-700"
            >
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {busy ? t('bookingCreating') : t('bookingCreate')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 p-4 sm:gap-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <form id={FORM_ID} onSubmit={entry.submit} className="min-w-0 space-y-4 sm:space-y-5">
          <BookingCustomerSection
            entry={entry}
            customers={customers}
            cataloguesLoaded={cataloguesLoaded}
            onCatalogueChanged={onCatalogueChanged}
          />
          <BookingTimeSection entry={entry} />
          <BookingRouteSection entry={entry} />
          <BookingCommercialSection entry={entry} />
          {/* Optional and folded: a booking with no crew is ordinary, and is
              crewed later from Lịch xe (`BookingCrewSection`). */}
          {mayDispatch && <BookingCrewSection entry={entry} vehicles={vehicles} />}
        </form>
        <BookingSummary entry={entry} customers={customers} className="lg:sticky lg:top-6" />
      </div>

      <PlaceDialog entry={entry} />
    </Modal>
  );
}
