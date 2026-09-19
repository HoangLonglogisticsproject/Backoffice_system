import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '../../common/errors/domain.error';
import type { AppConfig } from '../../config/app.config';
import { ServiceAuthGuard, serviceTokensMatch } from './service-auth.guard';

describe('ServiceAuthGuard (AI → backend)', () => {
  const EXPECTED = 'the-ai-to-backend-secret-00000000000000000';
  const OTHER_DIRECTION = 'the-backend-to-ai-secret-00000000000000000';

  const guardWith = (expected: string) =>
    new ServiceAuthGuard({ serviceTokenAiToBackend: expected } as unknown as AppConfig);

  const contextWith = (authorization?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: authorization === undefined ? {} : { authorization } }),
      }),
    }) as unknown as ExecutionContext;

  it('admits the correct bearer', () => {
    expect(guardWith(EXPECTED).canActivate(contextWith(`Bearer ${EXPECTED}`))).toBe(true);
  });

  it('refuses no token and a wrong token alike', () => {
    expect(() => guardWith(EXPECTED).canActivate(contextWith())).toThrow(UnauthorizedError);
    expect(() => guardWith(EXPECTED).canActivate(contextWith('Bearer nope'))).toThrow(UnauthorizedError);
  });

  it('refuses the OTHER direction\'s secret', () => {
    expect(() => guardWith(EXPECTED).canActivate(contextWith(`Bearer ${OTHER_DIRECTION}`))).toThrow(
      UnauthorizedError,
    );
  });

  it('is closed, not open, when the secret is not configured', () => {
    expect(() => guardWith('').canActivate(contextWith(`Bearer ${EXPECTED}`))).toThrow(UnauthorizedError);
    expect(() => guardWith('').canActivate(contextWith('Bearer '))).toThrow(UnauthorizedError);
  });

  it('never echoes the presented token', () => {
    const presented = 'LEAK-ME-000000000000000000000000000000000';
    try {
      guardWith(EXPECTED).canActivate(contextWith(`Bearer ${presented}`));
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as Error).message).not.toContain(presented);
    }
  });

  it('compares in constant time over digests, so lengths may differ', () => {
    expect(serviceTokensMatch('abc', 'abc')).toBe(true);
    expect(serviceTokensMatch('abc', 'abcd')).toBe(false);
    expect(serviceTokensMatch('anything', '')).toBe(false);
  });
});
