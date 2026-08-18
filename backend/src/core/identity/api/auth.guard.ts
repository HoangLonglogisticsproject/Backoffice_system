import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { UnauthorizedError } from '../../../common/errors/domain.error';
import { REQUEST_USER } from './current-user.decorator';
import { SESSION_COOKIE } from './session.cookie';
import { SessionService } from '../application/session.service';

/**
 * Turns the session cookie into a current user, or refuses the request.
 *
 * Opt-IN, applied per route rather than globally with a @Public escape hatch.
 * The two behave the same until someone adds an endpoint and forgets the
 * decorator — with a global guard that endpoint is protected, with opt-in it is
 * open. What makes this safe is that the guard's absence is visible on the line
 * above the handler, where review looks.
 *
 * Every rejection is identical: no cookie, unknown token, expired, revoked, or
 * a user disabled mid-session all produce one error. None of them is a probe.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = sessionTokenFrom(request);

    if (!token) throw new UnauthorizedError('Authentication required.');

    const user = await this.sessions.resolve(token);
    if (!user) throw new UnauthorizedError('Authentication required.');

    (request as unknown as Record<string, unknown>)[REQUEST_USER] = user;
    return true;
  }
}

/**
 * The cookie is the ONLY transport.
 *
 * No `Authorization: Bearer` fallback: a second way in is a second thing to
 * secure, and nothing needs it today. A programmatic client would want an API
 * credential with its own lifecycle anyway, not a browser session token.
 */
export function sessionTokenFrom(request: Request): string | null {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  const token = cookies?.[SESSION_COOKIE];
  return token && token.length > 0 ? token : null;
}
