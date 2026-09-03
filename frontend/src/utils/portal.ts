import type { AuthorizationMe } from '@/types/auth';

/**
 * Which application shell a session belongs in.
 *
 * ★ ONE PLACE, DERIVED FROM THE SESSION THE SERVER RETURNED. A `driver`
 * account is refused every Backoffice route by the server's
 * `BackofficeOnlyGuard`, whatever its `permissions` list says — so the shell
 * that draws those routes is simply not its shell. Everything that needs to
 * know "which portal is this person in" asks here rather than comparing an
 * account type of its own.
 *
 * ⚠ NAVIGATION, NOT AUTHORIZATION. This picks a screen; the server decides
 * every request regardless.
 */
export type Portal = 'backoffice' | 'driver';

export const portalOf = (authorization: AuthorizationMe): Portal =>
  authorization.accountType === 'driver' ? 'driver' : 'backoffice';

/** Where a ready session lands when it has nowhere more specific to go. */
export const homeOf = (authorization: AuthorizationMe): string =>
  portalOf(authorization) === 'driver' ? '/driver' : '/';
