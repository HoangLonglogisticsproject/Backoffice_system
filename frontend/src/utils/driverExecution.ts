import { EXECUTION_EVENT_TYPES } from '@/types/driver';
import type {
  CompletionRequest,
  DriverTripDetail,
  ExecutionEvent,
  ExecutionEventType,
  VehicleOwnership,
} from '@/types/driver';
import type { TripCost, TripCostCategory } from '@/types/tripCost';

/**
 * The driver's lifecycle, as pure functions.
 *
 * ★ WHY THIS IS NOT IN A COMPONENT. Every rule below is a business rule the
 * server also enforces — which event may be reported next, when a figure may be
 * corrected, when a completion may be sent. Spread across JSX they become
 * conditions nobody can test in isolation and nobody notices drifting from the
 * API. Here they are ordinary functions with ordinary tests, and the screens
 * only render what they return.
 *
 * ★ AND NOTHING HERE IS THE ENFORCEMENT. The server decides all of it and
 * answers 409 when the client is wrong. This exists so the driver is not
 * OFFERED an action that will fail — which on a phone at a fuel station is the
 * difference between a usable app and a confusing one.
 */

/**
 * ★ THE ONLY ORDER THERE IS. Arrive, load, arrive, hand over. The server refuses
 * anything else, and the portal never offers it.
 */
export const EXECUTION_ORDER = EXECUTION_EVENT_TYPES;

/** Where one step of the journey stands. */
export type StepState = 'done' | 'current' | 'upcoming';

export interface ExecutionStep {
  type: ExecutionEventType;
  state: StepState;
  /** When it actually happened, if it has. */
  actualAt: string | null;
  /** The planned time this step is measured against, if there is one. */
  scheduledAt: string | null;
}

/**
 * The canonical reading of one milestone — DL-86.
 *
 * ★ ARRIVING AND FINISHING ARE READ DIFFERENTLY, and it is not a detail.
 *
 *   ARRIVED_*    the FIRST non-voided reading — arriving is a moment, and a
 *                later duplicate must not make the trip look later than it was.
 *   CONFIRMED_*  the LAST non-voided reading — finishing is a state, and a
 *                driver who confirms, loads more and confirms again finished at
 *                the second one.
 *
 * ★ THE SAME RULE THE SERVER APPLIES, and it has to be: the portal shows the
 * driver a timeline while the board shows the office one, and two different
 * canonical rules would put two different times on one screen each.
 *
 * Tie-break `actual_at` → `recordedAt` → `id`, three deep, so two events landing
 * in the same millisecond still resolve the same way on every render.
 */
export const canonicalEventOf = (
  events: readonly ExecutionEvent[],
  type: ExecutionEventType,
): ExecutionEvent | null => {
  const live = events.filter((event) => event.type === type && event.voidedAt === null);

  /**
   * ★ THE FIRST READING IS THE SEED, AND THE REST ARE THE CONTEST.
   *
   * `live.reduce(f)` with no initial value does exactly this already — it takes
   * element 0 as the accumulator and starts folding at element 1 — but it also
   * throws on an empty array, so it only worked because of a length check
   * standing guard two lines above it. Spelling the seed out makes the empty
   * case a value the types can see rather than a rule a reader has to notice,
   * and `first` narrows away the `undefined` that indexing would leave.
   *
   * `arr.reduce(f)` ≡ `arr.slice(1).reduce(f, arr[0])`, so the winner is the
   * same event it always was.
   */
  const [first, ...rest] = live;
  if (!first) return null;

  const wantsEarliest = type === 'ARRIVED_PICKUP' || type === 'ARRIVED_DELIVERY';

  return rest.reduce((chosen, event) => (beats(event, chosen, wantsEarliest) ? event : chosen), first);
};

/**
 * Deterministic ordering: the instant, then the server's stamp, then the id.
 *
 * Only the FIRST key follows the milestone's direction. The two tie-breakers
 * are always ascending — they exist to make the answer reproducible, not to
 * express a preference — so the same events resolve the same way on every
 * render and on the server.
 *
 * ★ THE STRINGS ARE COMPARED AS STRINGS, AND THAT IS ONLY SAFE BECAUSE OF AN
 * INVARIANT WORTH WRITING DOWN: every stamp here is serialised by
 * `Date.toJSON`, so it is always `YYYY-MM-DDTHH:mm:ss.sssZ` — UTC, one fixed
 * width, no offset. For that shape lexicographic order IS chronological order,
 * which is why no parsing happens on a path that runs for every event on every
 * render. Both fields are non-null in `ExecutionEvent`; the server stamps them.
 *
 * ⚠ Send an offset like `+07:00`, or a variable number of fractional digits,
 * and this silently starts ordering by text. The invariant lives in the API
 * serialisation, so it is not this file that would break first — but it is
 * this file that would give the wrong answer.
 */
const beats = (
  candidate: ExecutionEvent,
  incumbent: ExecutionEvent,
  wantsEarliest: boolean,
): boolean => {
  if (candidate.actualAt !== incumbent.actualAt) {
    return wantsEarliest
      ? candidate.actualAt < incumbent.actualAt
      : candidate.actualAt > incumbent.actualAt;
  }

  if (candidate.recordedAt !== incumbent.recordedAt) {
    return candidate.recordedAt < incumbent.recordedAt;
  }

  return candidate.id < incumbent.id;
};

/**
 * Which event the driver may report next, or `null` when the journey is done.
 *
 * ★ ONE ACTION AT A TIME, AND THAT IS THE WHOLE INTERACTION DESIGN. Showing all
 * four buttons and letting the server refuse three of them is a screen that
 * teaches somebody standing beside a lorry to guess. The next step is the only
 * step.
 */
export const nextEvent = (events: readonly ExecutionEvent[]): ExecutionEventType | null =>
  EXECUTION_ORDER.find((type) => canonicalEventOf(events, type) === null) ?? null;

/**
 * The four steps, with the times that belong to each.
 *
 * The pickup steps are measured against the pickup time and the delivery steps
 * against the delivery time. Comparing either with the other produces a delay
 * wrong by the length of the journey.
 */
/**
 * Reported → `done`. Not reported but next in line → `current`. Otherwise it is
 * still ahead.
 *
 * ★ A FUNCTION RATHER THAN A NESTED TERNARY IN AN OBJECT LITERAL. The two
 * questions are independent — "has it happened" and "is it the one to do now" —
 * and reading them as one expression buried in a `map` hid that. `done` wins
 * over `current` because a reported step is finished regardless of what comes
 * next.
 */
const stepStateOf = (reported: boolean, isNext: boolean): StepState => {
  if (reported) return 'done';
  return isNext ? 'current' : 'upcoming';
};

export const executionSteps = (trip: DriverTripDetail): ExecutionStep[] => {
  const next = nextEvent(trip.events);

  return EXECUTION_ORDER.map((type) => {
    const event = canonicalEventOf(trip.events, type);
    const isPickupStep = type === 'ARRIVED_PICKUP' || type === 'PICKUP_CONFIRMED';

    return {
      type,
      state: stepStateOf(event !== null, type === next),
      actualAt: event?.actualAt ?? null,
      scheduledAt: isPickupStep ? trip.scheduledPickupAt : trip.scheduledDeliveryAt,
    };
  });
};

/**
 * How many minutes past the planned time, as a NUMBER and not a verdict.
 *
 * ★ NO THRESHOLD ANYWHERE. "Late" here means only that the planned moment has
 * passed and the step has not been reported. Whether that matters is a business
 * decision nobody has taken, and inventing one in the client would put a
 * judgement in front of a driver that the company never made.
 *
 * Measured to the ACTUAL time once reported, and to NOW while it is not — so an
 * unreported step keeps growing, which is the case worth surfacing. `null` when
 * nothing was planned: with no deadline there is nothing to be late against.
 */
export const lateByMinutes = (
  scheduledAt: string | null,
  actualAt: string | null,
  now: Date,
): number | null => {
  if (!scheduledAt) return null;

  const deadline = new Date(scheduledAt).getTime();
  const reached = actualAt ? new Date(actualAt).getTime() : now.getTime();

  return Math.max(0, Math.round((reached - deadline) / 60_000));
};

/** A step the driver still owes, whose planned time has already passed. */
export const isOverdue = (step: ExecutionStep, now: Date): boolean =>
  step.state !== 'done' && (lateByMinutes(step.scheduledAt, null, now) ?? 0) > 0;

// ------------------------------------------------------------------ expense --

/**
 * Which headings a driver may declare on THIS trip.
 *
 * ★ FUEL AND TOLLS DISAPPEAR ON A HIRED LORRY. The carrier absorbs both into
 * the one price agreed with them, so claiming either here is the same money
 * counted twice — the server refuses it with a CHECK constraint, and the portal
 * does not offer it.
 *
 * ⚠ AN UNCLASSIFIED LORRY KEEPS ALL FIVE. `null` ownership means nobody has
 * said whose lorry it is; treating that as "hired" would hide two legitimate
 * headings on the strength of a fact nobody stated.
 */
export const allowedCategories = (
  ownership: VehicleOwnership | null,
  all: readonly TripCostCategory[],
): TripCostCategory[] =>
  ownership === 'outsourced'
    ? all.filter((category) => category !== 'fuel' && category !== 'toll')
    : [...all];

/**
 * The ownership of the lorry this trip ran, as the events recorded it.
 *
 * ★ READ FROM THE SNAPSHOT, NOT FROM THE TRIP. The driver read model carries no
 * ownership field — deliberately, it is not the driver's business — but every
 * event and every declared line carries the snapshot taken when it was written.
 * Absent both, the answer is "unknown", and unknown keeps every category.
 */
export const vehicleOwnershipOf = (trip: DriverTripDetail): VehicleOwnership | null =>
  trip.events.find((event) => event.vehicleOwnership !== null)?.vehicleOwnership ??
  trip.expenses.find((line) => line.vehicleOwnership !== null)?.vehicleOwnership ??
  null;

/** A figure the driver may still correct. Locked and immutable lines cannot be. */
export const isEditable = (line: TripCost): boolean =>
  line.state === 'editable' && line.voidedAt === null;

/**
 * Whether new figures may be declared at all.
 *
 * Two conditions the server also applies: the trip must have a lorry (a figure
 * declared before one is assigned has nothing to attribute itself to), and the
 * money must not be frozen by a completion under review.
 */
export const canDeclareExpense = (trip: DriverTripDetail): boolean =>
  trip.vehicle !== null &&
  trip.completion?.state !== 'pending' &&
  trip.accountability !== 'APPROVED_IMMUTABLE';

/** Lines that still count. A withdrawn figure is not one. */
export const liveExpenses = (expenses: readonly TripCost[]): TripCost[] =>
  expenses.filter((line) => line.voidedAt === null);

// --------------------------------------------------------------- completion --

export type CompletionStage =
  /** Nothing sent yet, and the journey is not finished. */
  | 'not-ready'
  /** Everything reported; the driver may send it.  */
  | 'ready'
  /** Sent, waiting on a reviewer. Figures frozen. */
  | 'pending'
  /** Sent back. The reason is on the request, and the figures are open again. */
  | 'rejected'
  /** Closed. Nothing reopens it. */
  | 'approved';

/**
 * Where the completion stands.
 *
 * ★ `ready` REQUIRES THE FOUR EVENTS, AND THAT IS A UI RULE RATHER THAN A
 * SERVER ONE. The server deliberately does NOT refuse an early submission — a
 * driver who lost signal at the delivery point must still be able to close
 * their trip. So this gates the BUTTON, not the action: the ordinary path is
 * report-then-submit, and a trip that genuinely needs the exception is a
 * conversation with the office rather than a tap.
 */
export const completionStage = (trip: DriverTripDetail): CompletionStage => {
  const request: CompletionRequest | null = trip.completion;

  if (trip.accountability === 'APPROVED_IMMUTABLE' || request?.state === 'approved') {
    return 'approved';
  }
  if (request?.state === 'pending') return 'pending';
  if (request?.state === 'rejected') return 'rejected';

  return nextEvent(trip.events) === null ? 'ready' : 'not-ready';
};

/** May the driver send, or send again, right now? */
export const canSubmitCompletion = (trip: DriverTripDetail): boolean => {
  const stage = completionStage(trip);
  return stage === 'ready' || stage === 'rejected';
};

/**
 * The declaration that matches what the driver has actually entered.
 *
 * ★ A DEFAULT FOR THE FORM, NEVER AN ANSWER ON THE DRIVER'S BEHALF. The server
 * refuses a declaration that contradicts the data, so pre-selecting the
 * consistent one saves a guaranteed rejection — but the driver still has to
 * choose, and the screen makes both options visible and equal.
 */
export const suggestedDeclaration = (trip: DriverTripDetail) =>
  liveExpenses(trip.expenses).length > 0 ? ('expenses' as const) : ('none' as const);
