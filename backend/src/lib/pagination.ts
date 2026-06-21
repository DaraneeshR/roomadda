import { z } from "zod";

/** Cursor pagination limits (see /CLAUDE.md: every list endpoint is capped). */
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

export const limitSchema = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

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
