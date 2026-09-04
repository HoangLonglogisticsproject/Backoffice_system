import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import * as authApi from '@/api/auth';
import { isApiError } from '@/utils/errors';
import { notifyApiError, notifySuccess } from '@/utils/toast';
import type { AuthorizationMe, Identity } from '@/types/auth';

/**
 * Session state types - Contract §3b three-value union.
 *
 * The answer has THREE values, not two. The third is where integrations go wrong.
 * Modelling it as a union means a caller cannot forget the middle case.
 */
export type SessionState =
  | { status: 'anonymous' }
  | { status: 'password-change-required'; identity: Identity }
  | { status: 'ready'; authorization: AuthorizationMe };

/**
 * Resolves session state from authorization endpoint.
 *
 * Contract §3 three-state resolution:
 *   200                          → ready
 *   401 UNAUTHORIZED             → anonymous
 *   403 PASSWORD_CHANGE_REQUIRED → must change password
 *
 * ⚠ THE 403 IS NOT A LOGOUT. The cookie is alive and password change is required.
 */
async function fetchSessionState(): Promise<SessionState> {
  try {
    const authorization = await authApi.fetchAuthorization();
    return { status: 'ready', authorization };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.status === 401) {
      return { status: 'anonymous' };
    }

    if (error.status === 403 && error.is('PASSWORD_CHANGE_REQUIRED')) {
      // Session still resolves identity for change-password screen
      const identity = await authApi.fetchIdentity();
      return { status: 'password-change-required', identity };
    }

    // Plain 403 or other errors are not session states - rethrow
    throw error;
  }
}

/**
 * Query hook for current session state.
 *
 * Returns three-state union representing authentication status.
 * Data is cached with staleTime: Infinity (only refetch on explicit invalidation).
 */
export function useSession(): UseQueryResult<SessionState, Error> {
  return useQuery({
    queryKey: ['session'],
    queryFn: fetchSessionState,
    staleTime: Infinity, // Session doesn't auto-refresh
    gcTime: Infinity,    // Keep in cache forever
    retry: false,        // Don't retry 401/403
  });
}

/**
 * Mutation hook for login.
 *
 * After successful login, invalidates session query to trigger refetch.
 */
export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),

    onSuccess: () => {
      notifySuccess('toastSignedIn');
      // Invalidate session after login to refetch new session state
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },

    // ⚠ NO `onError` HERE, AND IT IS THE ONE DELIBERATE GAP. A failed sign-in
    // belongs beside the password field, not in a corner that fades: it carries
    // the wait after a 429 (`loginErrorMessage`, spec'd beside `LoginPage`) and
    // it is read by somebody who is about to type again. A toast would say the
    // same sentence in a worse place, twice.
  });
}

/**
 * Mutation hook for logout.
 *
 * After logout, clears ALL queries from cache (user is signing out).
 */
export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: authApi.logout,

    onSuccess: () => {
      notifySuccess('toastSignedOut');
      // Clear entire cache on logout
      queryClient.clear();
    },

    // ⚠ No receipt on this path. The cache is cleared either way, but nothing
    // was signed out on the server — saying "đã đăng xuất" would be a lie on the
    // one screen where it matters most.
    onError: () => {
      // Even if logout fails, clear local state
      // The user asked to leave, server-side session is server's problem
      queryClient.clear();
    },
  });
}

/**
 * Mutation hook for password change.
 *
 * Contract §1: Changes password and ends ALL sessions including current one.
 * Caller must redirect to login after success.
 */
export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      authApi.changePassword(currentPassword, newPassword),

    onSuccess: () => {
      // The message says "sign in again" because the redirect that follows
      // looks identical to being kicked out.
      notifySuccess('toastPasswordChanged');
      // Password change ends all sessions - clear cache
      queryClient.clear();
    },

    // The server's own words: "mật khẩu hiện tại không đúng" and "mật khẩu mới
    // không đạt yêu cầu" are different problems with different fixes, and only
    // the server can tell them apart.
    onError: (error) => notifyApiError(error, 'saveFailed'),
  });
}

/**
 * Query hook for identity only (no permissions).
 *
 * Works even on temporary credential (password-change-required state).
 * Usually you want useSession() instead - this is for special cases.
 */
export function useIdentity() {
  return useQuery({
    queryKey: ['session', 'identity'],
    queryFn: authApi.fetchIdentity,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
