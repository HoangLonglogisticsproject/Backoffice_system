import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as authApi from '../api/auth.repository';
import { current, type SessionState } from './session.repository';
import type { PermissionKey } from '../type/auth';

/**
 * Session state for the React tree, and the only writer of it.
 *
 * `loading` is separate from the three session states rather than a fourth
 * member of the union: "we have not asked yet" is not an answer about the
 * session, and folding it in would let a guard mistake "still checking" for
 * "anonymous" and redirect somebody who is signed in.
 */
interface SessionContextValue {
  state: SessionState | null;
  loading: boolean;
  /** Re-reads `/authorization/me`. §3: call after a 403, a 409, or a role change. */
  reload: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Render hint ONLY (§0, §14). The server re-decides on every request; hiding
   * a button is a convenience, never a control.
   */
  can: (permission: PermissionKey) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setState(await current());
    } catch {
      // `current()` only rethrows what is NOT a session state — a 500, a
      // network failure. Treating that as anonymous would sign people out on a
      // blip, so the previous state stands and the error surfaces where it was
      // raised.
      setState((previous) => previous ?? { status: 'anonymous' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await authApi.login(email, password);
      // The cookie is set by the response. What the session IS now still comes
      // from the server — a fresh account lands in `password-change-required`,
      // and only `/authorization/me` knows that.
      await reload();
    },
    [reload],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Local state clears even if the call failed: the user asked to leave,
      // and a server-side session that outlives the click is the server's to
      // expire.
      setState({ status: 'anonymous' });
    }
  }, []);

  const can = useCallback(
    (permission: PermissionKey) =>
      state?.status === 'ready' && state.authorization.permissions.includes(permission),
    [state],
  );

  const value = useMemo(
    () => ({ state, loading, reload, signIn, signOut, can }),
    [state, loading, reload, signIn, signOut, can],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
