import { useState } from 'react';
import { useEligibleDrivers } from '@/hooks/trip/useTripAssignment';
import type { TranslationKey } from '@/types/translate';

/**
 * One row of "Phương tiện điều độ" while it is being typed.
 *
 * ★ THIS IS AN INPUT SHAPE, NOT A DOMAIN ONE. It becomes a DispatchAssignment
 * the moment it is sent, and until then it is allowed to be half-filled —
 * which is the whole reason it carries its own `error`: the refusal belongs
 * beside the row that caused it, not at the bottom of the form.
 */
export interface CrewRow {
  key: string;
  vehicleId: string;
  driverUserId: string;
  error: string | null;
}

// A counter rather than `crypto.randomUUID()`: this only has to be unique
// within one open form, and the key never leaves the browser.
let crewKeySeq = 0;

const newCrewRow = (): CrewRow => {
  crewKeySeq += 1;
  return { key: `crew-${crewKeySeq}`, vehicleId: '', driverUserId: '', error: null };
};

/**
 * "Phương tiện điều độ" — the pairs typed alongside a NEW trip, and the two
 * rules that can be answered without the server. Each pair is sent to the
 * dispatch endpoint after the trip exists (`dispatchCrew`).
 */
export function useEntryCrew(driversWanted: boolean, t: (key: TranslationKey) => string) {
  /**
   * "Phương tiện điều độ" — the pairs typed alongside the trip.
   *
   * ★ EMPTY IS A PERFECTLY ORDINARY TRIP. Booking without a crew is still
   * supported and is still what happens when nobody has decided yet; these
   * rows only spare the dispatcher a second screen when they HAVE.
   */
  const [crew, setCrew] = useState<CrewRow[]>([]);

  // Read once the form is open and only for somebody who may actually dispatch.
  const drivers = useEligibleDrivers(driversWanted);

  /**
   * The lorries already spoken for by ANOTHER row of this form.
   *
   * ★ THE SAME PATTERN THE DISPATCH PANEL USES — it hides the lorries already
   * on the trip — and for the same reason: one lorry cannot be on one trip
   * twice, so offering it again only invites a refusal the user cannot see
   * coming. `checkCrew` still holds the rule, because a rule the UI merely
   * makes hard to break is not a rule.
   *
   * ⚠ It knows only about THIS form. A lorry already assigned on the server —
   * one that landed before a partial failure, say — is not in `crew` and is
   * still offered; that one is the server's to refuse, and it does.
   */
  const takenVehicleIds = new Set(crew.map((row) => row.vehicleId).filter((id) => id !== ''));

  const addCrew = () => setCrew((rows) => [...rows, newCrewRow()]);
  const removeCrew = (key: string) => setCrew((rows) => rows.filter((row) => row.key !== key));
  /** Editing a row clears its refusal — the message described the old value. */
  const setCrewAt = (key: string, patch: Partial<CrewRow>) =>
    setCrew((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch, error: null } : row)));

  /**
   * The two rules that can be answered without asking the server.
   *
   * A pair needs both halves — there is no lorry-only assignment — and one
   * lorry cannot be on the trip twice. The same DRIVER twice is left alone:
   * that is ordinary dispatch and the server accepts it.
   */
  const checkCrew = (rows: CrewRow[]): CrewRow[] => {
    const seen = new Set<string>();
    return rows.map((row) => {
      if (row.vehicleId === '' || row.driverUserId === '') {
        return { ...row, error: t('crewIncomplete') };
      }
      if (seen.has(row.vehicleId)) return { ...row, error: t('crewDuplicateVehicle') };
      seen.add(row.vehicleId);
      return { ...row, error: null };
    });
  };

  return { crew, setCrew, drivers, takenVehicleIds, addCrew, removeCrew, setCrewAt, checkCrew };
}
