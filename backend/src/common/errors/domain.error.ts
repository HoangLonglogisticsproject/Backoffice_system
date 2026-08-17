/**
 * Errors the application raises about its own rules, as opposed to errors
 * about HTTP.
 *
 * Core and capability code throws these; the HTTP layer decides what status
 * code each one becomes. That separation is what lets the same service be
 * called from a controller today and from a job runner tomorrow without the
 * rules learning what a 404 is.
 *
 * Only four kinds, because four is what the failures actually are. A taxonomy
 * of twenty is a taxonomy nobody picks from correctly.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Asked for something that is not there. */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
}

/**
 * Not authenticated: no credential, or one that no longer resolves.
 *
 * Distinct from ForbiddenError because clients act on the difference — 401
 * means "log in again", 403 means "logging in again will not help". Collapsing
 * them sends a user with an expired session to a dead end.
 */
export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED';
}

/**
 * Authenticated, but not allowed.
 *
 * Note for whoever implements authorization: returning this for a resource the
 * caller may not even know exists leaks its existence. Where that matters,
 * answer NotFoundError instead — the caller cannot tell "absent" from
 * "forbidden", which is the point.
 */
export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
}

/** The request is well-formed but breaks a rule of the domain. */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';

  constructor(
    message: string,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(message);
  }
}

/** The action is legal but the current state does not allow it right now. */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
}
