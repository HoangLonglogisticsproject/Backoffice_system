import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors/domain.error';

/**
 * Looked up by the error's own name rather than by class identity, so a module
 * can define its own DomainError without this file importing it — importing
 * from `core/` here would make `common/` depend on the layer above it.
 */
const STATUS_BY_CODE = new Map<string, HttpStatus>([
  ['TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS],
  // Refused like a ForbiddenError but carrying its own code, so it is mapped
  // here rather than by class — the mechanism working as intended.
  ['PASSWORD_CHANGE_REQUIRED', HttpStatus.FORBIDDEN],
]);

const STATUS_BY_ERROR = new Map<Function, HttpStatus>([
  [NotFoundError, HttpStatus.NOT_FOUND],
  [UnauthorizedError, HttpStatus.UNAUTHORIZED],
  [ForbiddenError, HttpStatus.FORBIDDEN],
  [ValidationError, HttpStatus.UNPROCESSABLE_ENTITY],
  [ConflictError, HttpStatus.CONFLICT],
]);

/**
 * Translates domain errors into HTTP, in one place.
 *
 * The alternative — every controller mapping its own errors — is how one
 * endpoint ends up answering 200 with `{ error: … }` while its neighbour
 * answers 403, and how a client ends up parsing both.
 */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      STATUS_BY_ERROR.get(error.constructor) ??
      STATUS_BY_CODE.get(error.code) ??
      HttpStatus.INTERNAL_SERVER_ERROR;

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`Unmapped domain error ${error.name}: ${error.message}`);
    }

    // Retry-After is the part a well-behaved client acts on; without it the
    // 429 is just a refusal with no guidance.
    const retryAfter = (error as DomainError & { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof retryAfter === 'number') {
      response.setHeader('Retry-After', String(retryAfter));
    }

    response.status(status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error instanceof ValidationError && error.details ? { details: error.details } : {}),
      },
    });
  }
}
