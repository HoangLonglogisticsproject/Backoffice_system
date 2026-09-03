import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '@/contexts/SessionProvider';
import { homeOf, portalOf, type Portal } from '@/utils/portal';

/**
 * Routes the three session states to the three places they belong (§3b), and a
 * ready session to the ONE shell that is its own.
 *
 * This is navigation, not authorization. It decides which SCREEN a session
 * state corresponds to; it never decides whether a caller may do something —
 * the server answers that on every request, and a 403 coming back is the
 * design working, not a bug (§0).
 *
 * ★ THE PORTAL CHECK IS NAVIGATION TOO. A driver holding a Backoffice URL — a
 * bookmark, a typed path, a link somebody forwarded — is sent to their own
 * home rather than shown a shell of links the server will refuse one by one.
 * An employee who lands on `/driver` is sent back for the same reason. Neither
 * redirect grants or denies anything: the server already did.
 */
export function SessionGuard({
  portal,
  children,
}: Readonly<{ portal: Portal; children: ReactNode }>) {
  const { state, loading } = useSession();
  const location = useLocation();

  // "Not asked yet" is not "not signed in". Redirecting here would bounce a
  // signed-in user out of the app on every cold load.
  if (loading || state === null) return null;

  if (state.status === 'anonymous') {
    // `from` lets login return them where they were aiming.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Signed in, but provisioning is unfinished. Everything except the identity
  // endpoints answers 403 until the password is changed (§12), so there is
  // exactly one screen this state can use.
  if (state.status === 'password-change-required') {
    return <Navigate to="/change-password" replace />;
  }

  if (portalOf(state.authorization) !== portal) {
    return <Navigate to={homeOf(state.authorization)} replace />;
  }

  return <>{children}</>;
}

// Export as RequireSession for backward compatibility
export { SessionGuard as RequireSession };
