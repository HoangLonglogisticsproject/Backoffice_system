import { ParseUUIDPipe } from '@nestjs/common';
import { ValidationError } from '../errors/domain.error';

/**
 * Validates a UUID route parameter before it reaches a repository.
 *
 * WHY THIS EXISTS. Every `:departmentId`, `:userId`, `:requestId` and
 * `:invitationId` is handed straight to a query as a `uuid` parameter. A value
 * that is not a UUID is not refused by the guard chain — the guards compare it
 * as a string, and a caller who is genuinely authorized for the route passes
 * them — so it reached PostgreSQL, which rejected the cast with SQLSTATE 22P02
 * (`invalid input syntax for type uuid`). That is not a `DomainError`, so the
 * filter did not map it and the caller got a bare 500.
 *
 * Nothing leaked: the body was Nest's generic "Internal server error" and the
 * PostgreSQL detail went only to the log. But 500 is the wrong answer to a
 * malformed request, and an endpoint that answers 500 to input teaches
 * monitoring to ignore its own error rate.
 *
 * Raises `ValidationError` rather than Nest's default `BadRequestException`, so
 * a malformed identifier answers 422 with `{ error: { code, message } }` —
 * the same shape and the same status as a malformed BODY already produced
 * through `ZodValidationPipe`. One contract, not two.
 *
 * NO VERSION IS PINNED. `gen_random_uuid()` returns v4 today, but pinning the
 * version here would make the API reject an identifier the database is
 * perfectly able to store, which is a bug waiting for the first row created any
 * other way.
 *
 * A shared instance because it is stateless and used at seventeen call sites;
 * constructing one per parameter would allocate seventeen identical pipes.
 */
export const UuidParam = new ParseUUIDPipe({
  exceptionFactory: () => new ValidationError('Malformed identifier.'),
});
