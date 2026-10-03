import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatPlate } from '@/utils/format';
import type { TripVehicle } from '@/types/trip';
import type { TripEntry } from '../entry/useTripEntryForm';
import { DriverSelect } from './DriverSelect';

/**
 * "Phương tiện điều độ" — the pairs typed alongside a NEW trip.
 *
 * ★ AN INPUT SURFACE AND NOTHING ELSE (ADR-0004). On save each row becomes
 * its own `POST /trip-schedules/:id/driver-assignments`, the same canonical
 * path the dispatch panel uses; the trip body carries no lorry. A row shows
 * its own refusal beside it — see `checkCrew` in the form.
 */
export function CrewFields({ entry, vehicles }: Readonly<{ entry: TripEntry; vehicles: TripVehicle[] }>) {
  const { t } = useLanguage();
  const { crew, takenVehicleIds } = entry;
  const drivers = entry.drivers.data ?? [];
  const driversLoading = entry.drivers.isLoading;
  const onChangeRow = entry.setCrewAt;
  const onRemoveRow = entry.removeCrew;
  const onAddRow = entry.addCrew;

  return (
    <fieldset className="space-y-3 rounded-lg border border-gray-200 p-3">
      <legend className="px-1 text-sm font-medium text-gray-700">{t('dispatchTitle')}</legend>

      {crew.map((row, index) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`trip-crew-vehicle-${index}`} className="text-sm font-medium text-gray-700">
                  {t('fieldVehicle')}
                </label>
                <select
                  id={`trip-crew-vehicle-${index}`}
                  value={row.vehicleId}
                  onChange={(event) => onChangeRow(row.key, { vehicleId: event.target.value })}
                  className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">{t('dispatchSelectVehicle')}</option>
                  {vehicles
                    // Its OWN choice always stays: a select cannot show a
                    // value it has no option for.
                    .filter((vehicle) => vehicle.id === row.vehicleId || !takenVehicleIds.has(vehicle.id))
                    .map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {formatPlate(vehicle.plate)}
                      </option>
                    ))}
                </select>
              </div>
              <DriverSelect
                id={`trip-crew-driver-${index}`}
                value={row.driverUserId}
                onChange={(value) => onChangeRow(row.key, { driverUserId: value })}
                options={drivers}
                loading={driversLoading}
                // The row says what is wrong, in its own words — see `checkCrew`.
                required={false}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => onRemoveRow(row.key)}>
              {t('dispatchRemove')}
            </Button>
          </div>
          {row.error && (
            <p role="alert" className="text-sm text-red-600">
              {row.error}
            </p>
          )}
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={onAddRow}
        disabled={vehicles.length === 0}
      >
        <Plus className="h-4 w-4" />
        {t('dispatchAdd')}
      </Button>
    </fieldset>
  );
}
