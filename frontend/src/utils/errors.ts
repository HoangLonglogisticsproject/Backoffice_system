/**
 * One error shape for the whole app, from the two the backend actually emits.
 *
 * Contract §11 is explicit that there are TWO:
 *
 *   business    { error: { code, message, details? } }   thrown by the backend
 *   framework   { message, error, statusCode }           thrown by Nest itself
 *
 * In the second, `error` is a STRING, so `body.error.code` is `undefined` — and
 * code that reaches for it without checking crashes on exactly the responses it
 * was written to handle (a wrong URL, a malformed body).
 *
 * Normalising once, here, is what lets every caller switch on `status` and
 * `code` and never look at `message`. Matching on message text is how a copy
 * edit in the backend silently breaks the login flow.
 */

/** Codes the frontend BRANCHES on. Others are shown, not interpreted. */
export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'TOO_MANY_ATTEMPTS';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** `undefined` for framework errors — they carry no business code. */
    readonly code: string | undefined,
    message: string,
    /** Field-level detail; only `VALIDATION_FAILED` carries it. */
    readonly details?: Record<string, string>,
    /** Seconds from `Retry-After`, present on 429. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  is(code: ApiErrorCode): boolean {
    return this.code === code;
  }
}

interface BusinessBody {
  error: { code?: string; message?: string; details?: Record<string, string> };
}

const isBusinessBody = (body: unknown): body is BusinessBody =>
  typeof body === 'object' &&
  body !== null &&
  'error' in body &&
  typeof (body as { error: unknown }).error === 'object' &&
  (body as { error: unknown }).error !== null;

const readMessage = (body: unknown): string | undefined => {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body as { message: unknown };
    if (typeof message === 'string') return message;
  }
  return undefined;
};

/**
 * Builds an `ApiError` from whatever the server sent.
 *
 * Never throws: an error path that can itself fail is an error path that
 * replaces the real failure with a confusing one.
 */
export function toApiError(
  status: number,
  body: unknown,
  retryAfterHeader?: string,
): ApiError {
  const retryAfter = Number(retryAfterHeader);
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;

  if (isBusinessBody(body)) {
    const { code, message, details } = body.error;
    return new ApiError(
      status,
      code,
      message ?? 'Request failed.',
      details,
      retryAfterSeconds,
    );
  }

  // Framework shape, or something unrecognised. No code, deliberately —
  // `undefined` is the honest answer and stops callers branching on noise.
  return new ApiError(
    status,
    undefined,
    readMessage(body) ?? 'Request failed.',
    undefined,
    retryAfterSeconds,
  );
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;
