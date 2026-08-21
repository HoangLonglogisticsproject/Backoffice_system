import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useSession as useSessionQuery, useLogin, useLogout, type SessionState } from '@/hooks/useAuth';
import type { PermissionKey } from '@/types/auth';

/**
 * Session state for the React tree.
 *
 * Now powered by TanStack Query instead of manual useState.
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

export function SessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  // TanStack Query hook for session state
  const sessionQuery = useSessionQuery();
  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  const state = sessionQuery.data ?? null;
  const loading = sessionQuery.isLoading;

  const reload = useCallback(async () => {
    await sessionQuery.refetch();
  }, [sessionQuery]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await loginMutation.mutateAsync({ email, password });
      // Session automatically refetches after login (handled by useLogin hook)
    },
    [loginMutation],
  );

  const signOut = useCallback(async () => {
    await logoutMutation.mutateAsync();
    // Cache automatically cleared after logout (handled by useLogout hook)
  }, [logoutMutation]);

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
