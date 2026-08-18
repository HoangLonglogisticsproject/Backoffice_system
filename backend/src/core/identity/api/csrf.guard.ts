import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ForbiddenError } from '../../../common/errors/domain.error';

/**
 * CSRF defence for cookie-authenticated, state-changing requests.
 *
 * The PRIMARY defence is `SameSite=strict` on the session cookie: the browser
 * simply does not attach it to any cross-site request, which removes CSRF as a
 * class rather than mitigating it.
 *
 * This guard is the second layer, and it exists for one reason — SameSite is
 * enforced by the browser, so it protects exactly as well as the browser in
 * front of you. Anything older than 2020, or a browser with the flag
 * off, falls back to nothing.
 *
 * The mechanism: require a header that a cross-origin page cannot set.
 * A form or an <img> can be aimed at this API from any site, but neither can
 * add a custom header — doing so upgrades the request to one that needs a CORS
 * preflight. So the header's presence proves a script sent it, and the CORS
 * policy decides whose script that may be.
 *
 * ⚠ THIS HOLDS WHETHER OR NOT CORS IS ENABLED, but for different reasons, and
 * both are worth stating because CORS_ORIGINS is a deployment setting:
 *
 *   CORS off (default)   No preflight is ever answered, so no cross-origin
 *                        script can set the header at all.
 *
 *   CORS on              Only origins on the allowlist get a successful
 *                        preflight. An attacker's origin is not on it, so its
 *                        preflight fails and the request never leaves the
 *                        browser. Note that `credentials: true` is what makes
 *                        the allowlist load-bearing here — and that the schema
 *                        refuses `*`, because a wildcard cannot carry
 *                        credentials and would void this reasoning.
 *
 * SameSite=Strict is unaffected by either: it is about *site*, not origin, so a
 * dev setup where the client is on :4200 and this API on :3000 still sends the
 * cookie, while a genuinely cross-site request never does.
 *
 * No token, no server-side state, nothing to synchronise. A double-submit
 * token would add a second cookie, a rotation story and a failure mode, and
 * would buy nothing over this for a JSON API.
 */

/** Any custom header would do; this one is conventional and already common. */
export const CSRF_HEADER = 'x-requested-with';

/** Read-only verbs change nothing, so they are not CSRF targets. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
    if (request.headers[CSRF_HEADER]) return true;

    throw new ForbiddenError(
      `State-changing requests must send the ${CSRF_HEADER} header.`,
    );
  }
}
