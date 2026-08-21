import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/utils/errors';

/**
 * TanStack Query configuration for the entire application.
 *
 * Default options apply to all queries and mutations unless overridden.
 * These settings balance between:
 * - UX: Fresh data without too many network requests
 * - Performance: Caching and deduplication
 * - Error handling: Smart retry logic
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * Data is considered fresh for 1 minute.
       * During this time, no background refetch happens.
       */
      staleTime: 60 * 1000, // 1 minute

      /**
       * Garbage collection time: 5 minutes.
       * Unused query data stays in cache for this duration.
       */
      gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)

      /**
       * Smart retry logic:
       * - Don't retry on 4xx errors (client errors, won't change)
       * - Retry up to 2 times on 5xx/network errors
       */
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          // Don't retry on client errors (4xx)
          if (error.status >= 400 && error.status < 500) {
            return false;
          }
        }
        // Retry on 5xx or network errors, max 2 attempts
        return failureCount < 2;
      },

      /**
       * Disable automatic refetch on window focus.
       * Users can manually refresh if needed.
       */
      refetchOnWindowFocus: false,

      /**
       * Disable refetch on reconnect.
       * Prevents surprise refetches when network comes back.
       */
      refetchOnReconnect: false,
    },

    mutations: {
      /**
       * Never retry mutations.
       * Mutations are writes - retrying could cause duplicate actions.
       */
      retry: false,
    },
  },
});
