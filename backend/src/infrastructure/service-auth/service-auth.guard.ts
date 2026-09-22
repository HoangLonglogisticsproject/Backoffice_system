import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { UnauthorizedError } from '../../common/errors/domain.error';
import { AppConfig } from '../../config/app.config';

/**
 * Authenticates the AI PLATFORM as a service, and nothing else (ADR-0007).
 *
 * ★ THIS IS NOT THE HUMAN AUTH MODEL AND MUST NEVER BE COMBINED WITH IT. No
 * cookie, no session, no `PermissionGuard`. It exists for the internal
 * read-model routes the AI will call in Phase 1b, which carry no user at all.
 * It lives in `infrastructure/` and not beside `AuthGuard` for that reason:
 * a reviewer seeing it on a route should read "a machine calls this", and a
 * route that needs both a person and a machine is a design error.
 *
 * One bearer secret, one direction (AI → backend). The credential the backend
 * presents to the AI is a DIFFERENT secret, held by the AI's env schema. Empty
 * configuration means the door is closed, not open.
 *
 * Never logs the presented token and never puts it in an error.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const presented = bearerTokenFrom(request);

    if (!presented || !serviceTokensMatch(presented, this.config.serviceTokenAiToBackend)) {
      throw new UnauthorizedError('Service authentication required.');
    }

    return true;
  }
}

/** `Authorization: Bearer <token>`, or null. */
export function bearerTokenFrom(request: Request): string | null {
  const header = request.headers['authorization'];
  if (typeof header !== 'string') return null;

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Constant-time equality over SHA-256 digests, so the two inputs are always
 * the same length and `timingSafeEqual` can run. An empty expected secret
 * matches nothing.
 */
export function serviceTokensMatch(presented: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
