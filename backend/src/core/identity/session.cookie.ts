import type { CookieOptions } from 'express';

/**
 * How the session token reaches the browser.
 *
 * A cookie, not a JSON field the client stores. The difference is XSS: any
 * script that runs on the page can read `localStorage` and exfiltrate a token
 * from it, and a backoffice renders enough user-supplied text that "no XSS
 * ever" is not a safety argument. An HttpOnly cookie is unreadable by script —
 * an XSS can still *act* as the user while the page is open, but it cannot
 * walk away with a credential that keeps working afterwards.
 */
export const SESSION_COOKIE = 'bo_session';

export function sessionCookieOptions(input: {
  expiresAt: Date;
  secure: boolean;
}): CookieOptions {
  return {
    // Unreadable from JavaScript.
    httpOnly: true,

    // HTTPS only in production. Left off in development because there is no
    // certificate on localhost and a cookie that never arrives is debugged as
    // "login is broken" for an afternoon.
    secure: input.secure,

    /**
     * Strict, not Lax.
     *
     * Lax still sends the cookie on top-level GET navigation from another
     * site, which is enough for a link that triggers a state change. Strict
     * costs one thing: following a link from an email lands on the login page
     * instead of the destination. For an internal tool that is the right
     * trade, and it removes CSRF as a class rather than mitigating it.
     */
    sameSite: 'strict',

    path: '/',

    // Matches the server-side session, so the browser stops sending a cookie
    // the server would only reject.
    expires: input.expiresAt,
  };
}

/** Same attributes minus lifetime — a cookie only clears if these match. */
export function clearSessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: '/' };
}
