/**
 * Cursor pagination helpers. The page-size limits, the `limitSchema` query
 * contract, and the `Page<T>` shape are defined once in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md) and re-exported here; only the
 * server-side `toPage` slicing logic lives in the backend.
 */
export { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, limitSchema } from "@roomadda/shared";
export type { Page } from "@roomadda/shared";

import type { Page } from "@roomadda/shared";

/**
 * Given `limit + 1` fetched rows, trim to `limit` and derive the next cursor
 * (the id of the last returned row) when a further page exists.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  if (rows.length > limit) {
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items, nextCursor: last ? last.id : null };
  }
  return { items: rows, nextCursor: null };
}
