/**
 * Errors the application raises about its own rules, as opposed to errors
 * about HTTP. Same taxonomy as the backend's `common/errors`, copied rather
 * than imported: the two applications share a doctrine, not a module.
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

/** Not authenticated: no credential, or one that does not verify. */
export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED';
}

/**
 * A user's trusted context did not verify — missing, tampered, expired, or
 * meant for another audience.
 *
 * Its own code, answered 401 like `UnauthorizedError`, because the backend's
 * correct reaction is different: a failed BEARER means the service credential
 * is wrong, a failed CONTEXT means the backend signed something the AI could
 * not accept. Collapsing the two would send an operator to the wrong secret.
 */
export class TrustedContextError extends DomainError {
  readonly code = 'INVALID_TRUSTED_CONTEXT';
}

/** Authenticated, but not allowed. */
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

/**
 * A lifecycle move the state machine does not admit — `resolved → open`, a
 * user resolving a dismissed alert, a second acknowledgement.
 *
 * A sibling of `ConflictError` with its own code so a client can tell "the
 * alert moved under you" from any other 409 without parsing the message.
 */
export class InvalidTransitionError extends DomainError {
  readonly code = 'INVALID_ALERT_TRANSITION';
}
