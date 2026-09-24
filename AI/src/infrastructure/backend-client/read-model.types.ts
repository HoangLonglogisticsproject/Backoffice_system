import { z } from 'zod';

/**
 * The backend's canonical facts, as this side reads them off the wire.
 *
 * ★ PARSED, NOT CAST. The two applications share no source (ADR-0007), so a
 * shape the backend changed is a shape this side must NOTICE rather than
 * silently misread — a missing `pickupAt` cast to `undefined` would make a
 * detector quietly evaluate `undefined <= now` and stop alerting. Every
 * response goes through these schemas, and a malformed page is a FAILED scan,
 * never an empty one.
 *
 * These mirror `backend/src/capabilities/trip-schedule/domain/ai-read-model.ts`;
 * the contract is documented in docs/backend/ai-internal-contracts.md §10 and
 * pinned by a spec on each side.
 */

/** An ISO-8601 instant on the wire; a `Date` in the domain. */
const instant = z.string().datetime({ offset: true }).pipe(z.coerce.date());
const nullableInstant = z.union([instant, z.null()]);

export const tripFactsSchema = z.object({
  tripId: z.string().uuid(),
  scheduledOn: z.string(),
  pickupAt: nullableInstant,
  deliveryAt: nullableInstant,
  status: z.enum(['pending', 'confirmed', 'executing', 'finished']),
  archived: z.boolean(),
  activeAssignmentCount: z.number().int().nonnegative(),
  customer: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
});
export type TripFacts = z.infer<typeof tripFactsSchema>;

export const completionStateSchema = z.enum(['none', 'pending', 'approved', 'rejected']);
export type CompletionState = z.infer<typeof completionStateSchema>;

export const assignmentFactsSchema = z.object({
  assignmentId: z.string().uuid(),
  tripId: z.string().uuid(),
  driverUserId: z.string().uuid(),
  vehicleId: z.string().uuid().nullable(),
  vehiclePlate: z.string().nullable(),
  state: z.enum(['active', 'ended']),
  assignedAt: instant,
  endedAt: nullableInstant,
  hasLiveEvents: z.boolean(),
  latestCompletionState: completionStateSchema,
  trip: tripFactsSchema,
});
export type AssignmentFacts = z.infer<typeof assignmentFactsSchema>;

export const completionRequestFactsSchema = z.object({
  requestId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  tripId: z.string().uuid(),
  attemptNo: z.number().int().positive(),
  state: z.enum(['pending', 'approved', 'rejected']),
  submittedAt: instant,
  decidedAt: nullableInstant,
  trip: tripFactsSchema,
});
export type CompletionRequestFacts = z.infer<typeof completionRequestFactsSchema>;

/** The keyset page envelope both applications use (ADR-0002). */
export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

export const subjectLookupSchema = z.object({
  trips: z.array(tripFactsSchema),
  assignments: z.array(assignmentFactsSchema),
  completionRequests: z.array(completionRequestFactsSchema),
});
export type SubjectLookupResult = z.infer<typeof subjectLookupSchema>;
