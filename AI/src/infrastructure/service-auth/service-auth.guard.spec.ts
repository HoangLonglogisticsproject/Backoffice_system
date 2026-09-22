import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '../../common/errors/domain.error';
import type { AppConfig } from '../../config/app.config';
import { bearerTokenFrom, ServiceAuthGuard, tokensMatch } from './service-auth.guard';

describe('ServiceAuthGuard (backend → AI)', () => {
  const EXPECTED = 'the-backend-to-ai-secret-0000000000000000';
  const OTHER_DIRECTION = 'the-ai-to-backend-secret-0000000000000000';

  const guardWith = (expected: string) =>
    new ServiceAuthGuard({ serviceTokenBackendToAi: expected } as unknown as AppConfig);

  const contextWith = (authorization?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: authorization === undefined ? {} : { authorization } }),
      }),
    }) as unknown as ExecutionContext;

  it('admits the correct bearer', () => {
    expect(guardWith(EXPECTED).canActivate(contextWith(`Bearer ${EXPECTED}`))).toBe(true);
    // Scheme is case-insensitive per RFC 9110; the token is not.
    expect(guardWith(EXPECTED).canActivate(contextWith(`bearer ${EXPECTED}`))).toBe(true);
  });

  it('refuses no token', () => {
    expect(() => guardWith(EXPECTED).canActivate(contextWith())).toThrow(UnauthorizedError);
    expect(() => guardWith(EXPECTED).canActivate(contextWith(''))).toThrow(UnauthorizedError);
    expect(() => guardWith(EXPECTED).canActivate(contextWith('Bearer'))).toThrow(UnauthorizedError);
  });

  it('refuses a wrong token, a prefix of the right one, and the right one with a suffix', () => {
    expect(() => guardWith(EXPECTED).canActivate(contextWith('Bearer nope'))).toThrow(UnauthorizedError);
    expect(() => guardWith(EXPECTED).canActivate(contextWith(`Bearer ${EXPECTED.slice(0, -1)}`))).toThrow(
      UnauthorizedError,
    );
    expect(() => guardWith(EXPECTED).canActivate(contextWith(`Bearer ${EXPECTED}x`))).toThrow(UnauthorizedError);
  });

  it('refuses the OTHER direction\'s token — two secrets, two doors', () => {
    expect(() => guardWith(EXPECTED).canActivate(contextWith(`Bearer ${OTHER_DIRECTION}`))).toThrow(
      UnauthorizedError,
    );
  });

  it('refuses a non-bearer scheme', () => {
    expect(() => guardWith(EXPECTED).canActivate(contextWith(`Basic ${EXPECTED}`))).toThrow(UnauthorizedError);
  });

  it('refuses everything when no secret is configured', () => {
    expect(() => guardWith('').canActivate(contextWith('Bearer '))).toThrow(UnauthorizedError);
    expect(() => guardWith('').canActivate(contextWith(`Bearer ${EXPECTED}`))).toThrow(UnauthorizedError);
  });

  it('never puts the presented token in the error it throws', () => {
    const presented = 'LEAK-ME-IF-YOU-DARE-000000000000000000000';
    try {
      guardWith(EXPECTED).canActivate(contextWith(`Bearer ${presented}`));
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as Error).message).not.toContain(presented);
    }
  });

  describe('tokensMatch', () => {
    it('is exact, and false for an empty expected secret', () => {
      expect(tokensMatch('abc', 'abc')).toBe(true);
      expect(tokensMatch('abc', 'abd')).toBe(false);
      expect(tokensMatch('', '')).toBe(false);
      expect(tokensMatch('anything', '')).toBe(false);
    });

    it('compares values of different lengths without throwing', () => {
      expect(tokensMatch('short', 'a much longer expected value')).toBe(false);
    });
  });

  describe('bearerTokenFrom', () => {
    it('extracts the token and nothing else', () => {
      const req = (authorization: unknown) => ({ headers: { authorization } }) as never;
      expect(bearerTokenFrom(req('Bearer abc'))).toBe('abc');
      expect(bearerTokenFrom(req('  Bearer   abc  '))).toBe('abc');
      expect(bearerTokenFrom(req('Bearer a b'))).toBeNull();
      expect(bearerTokenFrom(req(['Bearer abc']))).toBeNull();
      expect(bearerTokenFrom(req(undefined))).toBeNull();
    });
  });
});
