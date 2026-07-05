import { useCallback, useEffect, useState } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import type { Page } from "@roomadda/shared";

/**
 * Server-driven cursor pagination. Keeps a stack of page cursors so Previous
 * works; the current cursor is part of the query key so each page is cached.
 *
 * The response type `R` defaults to `Page<T>` but can be widened (e.g. a ledger
 * response that also carries filtered `totals`) — pass it as the second type
 * param and read the extra fields off the returned `data`.
 */
export function usePaginatedQuery<T, R extends Page<T> = Page<T>>(
  key: QueryKey,
  fetcher: (cursor: string | undefined, limit: number) => Promise<R>,
  limit = 20,
) {
  const [stack, setStack] = useState<Array<string | undefined>>([undefined]);
  const cursor = stack[stack.length - 1];

  // Reset to the first page whenever the filter (part of the key) changes.
  const keyStr = JSON.stringify(key);
  useEffect(() => {
    setStack([undefined]);
  }, [keyStr]);

  const query = useQuery({
    queryKey: [...key, cursor, limit],
    queryFn: () => fetcher(cursor, limit),
    placeholderData: (prev) => prev,
  });

  const next = useCallback(() => {
    const nextCursor = query.data?.nextCursor;
    if (nextCursor) setStack((s) => [...s, nextCursor]);
  }, [query.data?.nextCursor]);

  const prev = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  return {
    items: query.data?.items ?? [],
    /** The full page response (e.g. for a ledger's `totals`); undefined until loaded. */
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    next,
    prev,
    hasNext: Boolean(query.data?.nextCursor),
    hasPrev: stack.length > 1,
  };
}
