import { z } from 'zod';

/**
 * Login input.
 *
 * `subject` rather than `email`: the field is whatever the provider identifies
 * a user by, and today's provider happening to use email is not a reason to
 * bake it into the contract.
 *
 * Bounds are protective, not cosmetic — an unbounded password field is an
 * unbounded amount of scrypt work per request.
 */
export const loginSchema = z.object({
  subject: z.string().trim().min(1, 'subject is required').max(320),
  password: z.string().min(1, 'password is required').max(1024),
});

export type LoginInput = z.infer<typeof loginSchema>;
