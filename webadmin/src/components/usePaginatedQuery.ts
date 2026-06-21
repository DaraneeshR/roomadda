import { useCallback, useEffect, useState } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import type { Page } from "@roomadda/shared";

/**
 * Server-driven cursor pagination. Keeps a stack of page cursors so Previous
 * works; the current cursor is part of the query key so each page is cached.
 */
export function usePaginatedQuery<T>(
  key: QueryKey,
  fetcher: (cursor: string | undefined, limit: number) => Promise<Page<T>>,
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
    isFetching: query.isFetching,
    refetch: query.refetch,
    next,
    prev,
    hasNext: Boolean(query.data?.nextCursor),
    hasPrev: stack.length > 1,
  };
}
