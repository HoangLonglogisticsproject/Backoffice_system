import { ParseUUIDPipe } from '@nestjs/common';
import { ValidationError } from '../errors/domain.error';

/**
 * Validates a UUID route parameter before it reaches a query. A malformed id
 * answers 422 in the shared envelope rather than a bare 500 from a failed
 * `uuid` cast. No version pinned — `gen_random_uuid()` is v4 today, but the
 * API must accept whatever the database can store.
 */
export const UuidParam = new ParseUUIDPipe({
  exceptionFactory: () => new ValidationError('Malformed identifier.'),
});
