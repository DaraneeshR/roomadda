import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./apiClient";
import { pushToast } from "./toastBus";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Something went wrong";
}

/** 401s are handled by the interceptor (redirect to login) — don't toast them. */
const isAuthError = (error: unknown): boolean => error instanceof ApiError && error.status === 401;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (!isAuthError(error)) pushToast(errorMessage(error));
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (!isAuthError(error)) pushToast(errorMessage(error));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Don't retry our API errors (4xx/5xx); retry transient network errors once.
      retry: (count, error) => !(error instanceof ApiError) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});
