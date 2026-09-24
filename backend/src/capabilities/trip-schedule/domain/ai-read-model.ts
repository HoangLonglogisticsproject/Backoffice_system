import type { TripStatus } from './trip-schedule';

/**
 * CANONICAL FACTS for the AI Platform's detectors (ADR-0007 §2.11).
 *
 * ★ FACTS, NEVER VERDICTS. Every field here is something the backend KNOWS —
 * a status, a timestamp, a count, whether a live event exists. Nothing here
 * says "this is an alert", "this is late", "this is warning or high". Those
 * are alert policy, and alert policy lives in `/AI`. The backend says what is
 * true; the AI decides whether that truth means an alert.
 *
 * The shapes are the wire contract documented in
 * docs/backend/ai-internal-contracts.md §10; the AI keeps its own copy and
 * pins it with a spec, because the two applications share no source.
 *
 * Timestamps are `Date` here and ISO-8601 UTC on the wire; `scheduledOn` is
 * the calendar day as text and never becomes a `Date` (see `TripSchedule`).
 */

export interface TripFacts {
  tripId: string;
  scheduledOn: string;
  pickupAt: Date | null;
  deliveryAt: Date | null;
  status: TripStatus;
  archived: boolean;
  /** `trip_driver_assignments` rows with `state = 'active'` — the canonical "assigned" fact. */
  activeAssignmentCount: number;
  customer: { id: string; name: string } | null;
}

export type CompletionState = 'none' | 'pending' | 'approved' | 'rejected';

export interface AssignmentFacts {
  assignmentId: string;
  tripId: string;
  driverUserId: string;
  vehicleId: string | null;
  vehiclePlate: string | null;
  state: 'active' | 'ended';
  assignedAt: Date;
  endedAt: Date | null;
  /** The backend's own definition of "started": one non-voided execution event (ADR-0004). */
  hasLiveEvents: boolean;
  /** The state of the assignment's latest completion attempt, or `none`. */
  latestCompletionState: CompletionState;
  trip: TripFacts;
}

export interface CompletionRequestFacts {
  requestId: string;
  assignmentId: string;
  tripId: string;
  attemptNo: number;
  state: 'pending' | 'approved' | 'rejected';
  submittedAt: Date;
  decidedAt: Date | null;
  trip: TripFacts;
}

export interface SubjectLookupResult {
  trips: TripFacts[];
  assignments: AssignmentFacts[];
  completionRequests: CompletionRequestFacts[];
}
