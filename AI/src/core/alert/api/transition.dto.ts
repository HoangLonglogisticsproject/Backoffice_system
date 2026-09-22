import { z } from 'zod';
import { TRANSITION_TARGETS } from '../domain/alert-transition';

/**
 * `POST /internal/v1/alerts/:alertId/transitions`
 *
 * `context` is the signed trusted context the backend minted for the person
 * performing the action. The shape check here is "a non-empty string"; the
 * signature, audience and expiry are verified by the service-auth layer,
 * which answers 401 rather than 422 — an unverifiable context is a
 * credential problem, not a malformed body.
 *
 * Whether `reason` is required depends on `to` and is a domain rule
 * (`normaliseReason`), not a schema rule.
 */
export const transitionBodySchema = z.object({
  to: z.enum(TRANSITION_TARGETS),
  reason: z.string().trim().max(1000).optional(),
  context: z.string().min(1),
});

export type TransitionBody = z.infer<typeof transitionBodySchema>;
