import { useEffect, useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  useChangeDriverAssignment,
  useEligibleDrivers,
  useTripAssignments,
} from '@/hooks/trip/useTripAssignment';
import { isApiError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format/datetime';
import { formatPlate } from '@/utils/format';
import { DriverSelect } from './DriverSelect';
import type { DriverAssignment } from '@/api/tripAssignment';
import type { UserSummary } from '@/types/organization';
import type { TripAssignmentRef, TripScheduleWithRefs, TripVehicle } from '@/types/trip';

interface Props {
  /** The trip being dispatched, or `null` when closed. */
  trip: TripScheduleWithRefs | null;
  /** The active lorries of the catalogue — what may be added. */
  vehicles: TripVehicle[];
  onClose: () => void;
}

/**
 * "Phương tiện điều độ" — every lorry on a trip, each with its driver.
 *
 * ★ THE TRIP TAKES ANY NUMBER OF LORRIES, EACH A PAIR (ADR-0004). Adding one
 * means choosing a lorry AND a driver together; there is no lorry-only row and
 * no "fill the driver in later". The same driver may be put on a second lorry;
 * the same lorry may not be on the trip twice, and the list offered below
 * already leaves out the ones that are.
 *
 * ★ BEFORE A TURN STARTS, IT CAN BE SWAPPED OR REMOVED; AFTER, IT CANNOT.
 * `started` comes from the server — one live milestone reported — and once it
 * is true the row shows no control at all: the server would refuse with a 409,
 * and a button whose only outcome is a refusal is worse than no button.
 * Changing the lorry is "remove, then add"; history keeps both turns.
 *
 * ★ OPERATIONS DOES THIS, NEVER THE DRIVER. The panel lives on the dispatch
 * board behind `trip.write`; the Driver Portal has no such control and the
 * server refuses a driver account the route outright.
 *
 * ★ A 409 IS THE BOARD MOVING, AND THE ANSWER IS TO LOOK AGAIN. The mutation
 * re-reads the board and this trip's dispatch history on settle, so a refusal
 * shows the truth rather than a guess.
 */
export function DispatchPanel({ trip, vehicles, onClose }: Readonly<Props>) {
  const { t } = useLanguage();
  const open = trip !== null;
  const drivers = useEligibleDrivers(open);
  const history = useTripAssignments(trip?.id ?? null);

  const [adding, setAdding] = useState(false);

  // Reset per trip, not per render: reopening on another row must not carry a
  // half-filled form across.
  useEffect(() => setAdding(false), [trip?.id]);

  // ★ THE ACTIVE ROWS COME FROM THE BOARD, which is already on screen, so the
  // panel opens without waiting; the ended turns come from the history read.
  const active = trip?.assignments ?? [];
  const ended = history.assignments.filter((turn) => turn.state === 'ended');
  const takenVehicleIds = new Set(active.map((turn) => turn.vehicle?.id).filter(Boolean));
  const offeredVehicles = vehicles.filter((vehicle) => !takenVehicleIds.has(vehicle.id));
  const closed = trip?.status === 'finished';

  // ★ THE SECTION GUARDS ARE NAMED HERE, NOT SPELLED INLINE. Each
  // `cond ? (…) : null` in the tree below is a conditional nested inside the
  // outer one, and six of them is what put this component at a cognitive
  // complexity of 17. Named booleans plus `&&` say the same thing without the
  // nesting, and the tree reads as the list of sections it actually is.
  const showLegacyVehicle = active.length === 0 && trip?.legacyVehicleId != null;
  const showAddButton = !closed && !adding;
  const showAddForm = !closed && adding;
  const showHistory = !history.error && ended.length > 0;

  return (
    <Modal isOpen={open} onClose={onClose} title={t('dispatchTitle')}>
      {trip && (
        <div className="space-y-4">
          {/* ★ A LEGACY LORRY, NEVER CREWED. Trips booked with a lorry before
              dispatch became a pair still carry it on the row; it is shown so
              Operations knows what was planned and re-dispatches it as a pair.

              ★ AND IT READS `legacyVehicleId`, WHICH IS THE WHOLE POINT OF THE
              NAME. The canonical source cannot answer this one: the branch runs
              only when `active.length === 0`, and migration 0029 case F leaves
              exactly those rows uncrewed on purpose — "there is no driver to
              pair it with, and a lorry-only assignment is not a thing". So the
              legacy column is the only place the fact exists, and dropping the
              read would silently turn a re-dispatch prompt into a plain "not
              assigned". */}
          {showLegacyVehicle && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('dispatchLegacyVehicle')}
            </p>
          )}

          {active.length === 0 ? (
            <p className="text-sm text-gray-500">{t('dispatchEmpty')}</p>
          ) : (
            <ol className="space-y-2" aria-label={t('dispatchTitle')}>
              {active.map((turn, index) => (
                <AssignmentRow
                  key={turn.id}
                  index={index + 1}
                  tripId={trip.id}
                  turn={turn}
                  drivers={drivers.data ?? []}
                  locked={closed}
                />
              ))}
            </ol>
          )}

          {showAddButton && (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setAdding(true)}
              disabled={offeredVehicles.length === 0}
            >
              <Plus className="h-4 w-4" />
              {t('dispatchAdd')}
            </Button>
          )}

          {showAddForm && (
            <AddAssignmentForm
              tripId={trip.id}
              vehicles={offeredVehicles}
              drivers={drivers.data ?? []}
              driversLoading={drivers.isLoading}
              onDone={() => setAdding(false)}
            />
          )}

          {/* ★ A FAILED HISTORY READ SAYS SO. Silence here would read as
              "no turn was ever ended", which is a claim about the record. */}
          {history.error != null && (
            <p role="alert" className="text-xs text-red-600">
              {t('dispatchHistoryFailed')}
            </p>
          )}
          {showHistory && <History turns={ended} />}
        </div>
      )}
    </Modal>
  );
}

/**
 * The sentence a refused change shows. A 409 is the board having moved — the
 * mutation re-reads it — so it gets the sentence that says so; any other
 * server refusal is shown in the server's words; anything else is generic.
 * One place for both forms, so the two cannot drift.
 */
const refusalOf = (error: unknown, t: (key: 'assignConflict' | 'saveFailed') => string): string => {
  if (!isApiError(error)) return t('saveFailed');
  return error.status === 409 ? t('assignConflict') : error.message;
};

/**
 * One active pair: the lorry, the driver, and — only while the turn has not
 * started — the two things Operations may still do to it.
 */
function AssignmentRow({
  index,
  tripId,
  turn,
  drivers,
  locked,
}: Readonly<{
  index: number;
  tripId: string;
  turn: TripAssignmentRef;
  drivers: UserSummary[];
  locked: boolean;
}>) {
  const { t, language } = useLanguage();
  const change = useChangeDriverAssignment();
  const [mode, setMode] = useState<'idle' | 'replace' | 'end'>('idle');
  const [driverUserId, setDriverUserId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode('idle');
    setDriverUserId('');
    setReason('');
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (change.isPending) return;
    setError(null);
    try {
      await change.mutateAsync(
        mode === 'replace'
          ? { kind: 'replace', tripId, assignmentId: turn.id, driverUserId, reason: reason.trim() }
          : { kind: 'end', tripId, assignmentId: turn.id, reason: reason.trim() },
      );
      reset();
    } catch (error_) {
      setError(refusalOf(error_, t));
    }
  };

  const formId = `dispatch-${turn.id}-${mode}`;
  const replacing = mode === 'replace';
  const canSubmit = !change.isPending && reason.trim() !== '' && (!replacing || driverUserId !== '');
  // Derived once, so the markup below asks no compound questions.
  const canChange = !turn.started && !locked && mode === 'idle';
  const actionLabel = replacing ? t('changeDriver') : t('dispatchRemove');
  const submitLabel = change.isPending ? t('saving') : actionLabel;
  const reasonLabel = replacing ? t('assignReason') : t('dispatchEndReason');

  return (
    <li className="rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium text-gray-500">{index}.</span>
          <span className="flex items-center gap-1.5 font-medium text-gray-900">
            <Truck className="h-4 w-4 text-gray-500" aria-hidden="true" />
            {/* ★ `null` only on a pre-multi-vehicle row the migration could not
                backfill — said out loud, so Operations removes and re-adds it. */}
            {turn.vehicle ? formatPlate(turn.vehicle.plate) : <span className="text-amber-700">{t('dispatchMissingVehicle')}</span>}
          </span>
          <span className="text-gray-700">{turn.driver.displayName}</span>
          <span className="text-xs text-gray-400">{formatDateTime(turn.assignedAt, language)}</span>
        </div>

        {/* ★ NO CONTROL ONCE THE TURN HAS STARTED — the pair is what happened. */}
        {turn.started ? (
          <span className="text-xs font-medium text-blue-700">{t('dispatchStarted')}</span>
        ) : null}
        {canChange ? (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setMode('replace')}>
              {t('changeDriver')}
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-red-700" onClick={() => setMode('end')}>
              {t('dispatchRemove')}
            </Button>
          </div>
        ) : null}
      </div>

      {mode !== 'idle' ? (
        <form id={formId} onSubmit={submit} className="mt-3 space-y-2">
          {replacing ? (
            <DriverSelect
              id={`${formId}-driver`}
              value={driverUserId}
              onChange={setDriverUserId}
              // The incumbent is not offered as their own replacement; anybody
              // else is, including a driver already on another lorry of this trip.
              options={drivers.filter((driver) => driver.id !== turn.driver.id)}
              loading={false}
            />
          ) : null}
          <div className="space-y-1">
            <label htmlFor={`${formId}-reason`} className="text-sm font-medium text-gray-700">
              {reasonLabel}
            </label>
            <textarea
              id={`${formId}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              required
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reset} disabled={change.isPending}>
              {t('cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit} className="bg-blue-600 hover:bg-blue-700">
              {submitLabel}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/**
 * A lorry AND a driver, together. Submit stays disabled until both are chosen,
 * because there is no lorry-only assignment to send.
 */
function AddAssignmentForm({
  tripId,
  vehicles,
  drivers,
  driversLoading,
  onDone,
}: Readonly<{
  tripId: string;
  vehicles: TripVehicle[];
  drivers: UserSummary[];
  driversLoading: boolean;
  onDone: () => void;
}>) {
  const { t } = useLanguage();
  const change = useChangeDriverAssignment();
  const [vehicleId, setVehicleId] = useState('');
  const [driverUserId, setDriverUserId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (change.isPending || vehicleId === '' || driverUserId === '') return;
    setError(null);
    try {
      await change.mutateAsync({ kind: 'assign', tripId, vehicleId, driverUserId });
      onDone();
    } catch (error_) {
      setError(refusalOf(error_, t));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="dispatch-add-vehicle" className="text-sm font-medium text-gray-700">
            {t('fieldVehicle')}
          </label>
          <select
            id="dispatch-add-vehicle"
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            required
            className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">{t('dispatchSelectVehicle')}</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {formatPlate(vehicle.plate)}
              </option>
            ))}
          </select>
        </div>
        <DriverSelect
          id="dispatch-add-driver"
          value={driverUserId}
          onChange={setDriverUserId}
          options={drivers}
          loading={driversLoading}
        />
      </div>
      {!driversLoading && drivers.length === 0 ? (
        <p className="text-xs text-gray-500">{t('noEligibleDrivers')}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={change.isPending}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={change.isPending || vehicleId === '' || driverUserId === ''}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {change.isPending ? t('saving') : t('dispatchAdd')}
        </Button>
      </div>
    </form>
  );
}

/** The turns that ended, with who, when and why — never deleted, always readable. */
function History({ turns }: Readonly<{ turns: DriverAssignment[] }>) {
  const { t, language } = useLanguage();
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t('dispatchHistory')}
      </h3>
      <ul className="space-y-1">
        {turns.map((turn) => (
          <li key={turn.id} className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">
              {turn.vehicle ? formatPlate(turn.vehicle.plate) : t('dispatchMissingVehicle')}
            </span>
            {' · '}
            {turn.driverUser.displayName}
            {' · '}
            {formatDateTime(turn.assignedAt, language)}
            {turn.endedAt ? ` → ${formatDateTime(turn.endedAt, language)}` : ''}
            {turn.endReason ? ` · ${turn.endReason}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}
