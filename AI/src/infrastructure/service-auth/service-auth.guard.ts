import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { UnauthorizedError } from '../../common/errors/domain.error';
import { AppConfig } from '../../config/app.config';

/**
 * Authenticates the BACKEND as a service, and nothing else.
 *
 * This is not the human auth model and never will be: no session, no cookie,
 * no permission. One bearer secret, one direction (backend → AI), compared in
 * constant time. A wrong or missing token is refused with one message, so a
 * caller cannot tell "no such secret" from "wrong secret".
 *
 * ★ NEVER LOGS THE PRESENTED TOKEN, and never puts it in an error. The only
 * thing that happens to it is a digest comparison.
 *
 * Network isolation (no published port, proxy 404) is defence in depth around
 * this guard, not a substitute for it.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const presented = bearerTokenFrom(request);

    if (!presented || !tokensMatch(presented, this.config.serviceTokenBackendToAi)) {
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
 * Constant-time equality over SHA-256 digests. Hashing first makes both
 * inputs the same length, so `timingSafeEqual` can run and a length
 * difference leaks nothing. An empty expected secret matches nothing.
 */
export function tokensMatch(presented: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
