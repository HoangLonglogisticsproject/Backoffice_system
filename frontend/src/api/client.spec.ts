import { describe, expect, it } from 'vitest';
import { httpClient, CSRF_HEADER, CSRF_HEADER_VALUE } from './client';
import { ApiError, toApiError } from '@/utils/errors';

/**
 * The transport contract: what every request carries, and what every failure
 * turns into. These are the two rules that break by being forgotten at one
 * call site, so they are asserted on the shared client rather than per feature.
 */

/** Runs the real request interceptor without a server. */
const runRequestInterceptor = async (method: string) => {
  const handler = httpClient.interceptors.request as unknown as {
    handlers: { fulfilled: (c: unknown) => unknown }[];
  };
  const config = {
    method,
    url: '/anything',
    headers: new (
      await import('axios')
    ).AxiosHeaders(),
  };
  return handler.handlers[0].fulfilled(config) as { headers: { get: (k: string) => unknown } };
};

describe('httpClient', () => {
  it('sends the session cookie on every request', () => {
    // The session is an HttpOnly cookie and the only credential there is
    // (§1). Without this the client is permanently anonymous.
    expect(httpClient.defaults.withCredentials).toBe(true);
  });

  describe('CSRF header, by method and not by endpoint (§2)', () => {
    it.each(['post', 'put', 'patch', 'delete'])('adds it to %s', async (method) => {
      const config = await runRequestInterceptor(method);
      expect(config.headers.get(CSRF_HEADER)).toBe(CSRF_HEADER_VALUE);
    });

    it.each(['get', 'head', 'options'])('does not add it to %s', async (method) => {
      const config = await runRequestInterceptor(method);
      expect(config.headers.get(CSRF_HEADER)).toBeUndefined();
    });

    it('adds it regardless of case, since axios does not normalise for us', async () => {
      const config = await runRequestInterceptor('DELETE');
      expect(config.headers.get(CSRF_HEADER)).toBe(CSRF_HEADER_VALUE);
    });
  });
});

describe('toApiError', () => {
  it('reads the BUSINESS shape { error: { code, message } }', () => {
    const error = toApiError(403, {
      error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change required.' },
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(error.is('PASSWORD_CHANGE_REQUIRED')).toBe(true);
  });

  it('keeps VALIDATION_FAILED details for field-level display', () => {
    const error = toApiError(422, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request failed validation.',
        details: { subject: 'Required' },
      },
    });

    expect(error.details).toEqual({ subject: 'Required' });
  });

  it('survives the FRAMEWORK shape, where `error` is a string (§11)', () => {
    // `body.error.code` would throw here. This is the shape a wrong URL
    // returns, so the error path must not itself fail.
    const error = toApiError(404, {
      message: 'Cannot GET /nope',
      error: 'Not Found',
      statusCode: 404,
    });

    expect(error.code).toBeUndefined();
    expect(error.message).toBe('Cannot GET /nope');
    expect(error.is('NOT_FOUND')).toBe(false);
  });

  it('reads Retry-After on 429, which is what a client acts on', () => {
    const error = toApiError(429, { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many.' } }, '898');
    expect(error.retryAfterSeconds).toBe(898);
  });

  it('reports an unreachable server as status 0, not a invented 500', () => {
    // "never reached the server" and "server said no" need different answers.
    const error = toApiError(0, undefined);
    expect(error.status).toBe(0);
    expect(error.code).toBeUndefined();
  });
});
