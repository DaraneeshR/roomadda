import type { UpdateHostListingInput, UpdateHostRoomInput } from "@roomadda/shared";

/**
 * Edit classification (pure logic, unit-tested). A host edit either goes live
 * immediately (a "minor" edit) or RE-QUEUES the listing for approval. Per the
 * lifecycle spec, a change re-queues when:
 *   - the ADDRESS changes (fullAddress / pincode / latitude / longitude), or
 *   - the VISIBILITY (distribution channel) changes — the admin must re-vet which
 *     surface a listing appears on (Hotel B2C add-on), or
 *   - a room's monthly rent changes by MORE than 20%.
 * Everything else is a minor edit. This module only decides; the service applies
 * the status transition and writes the edit-history log.
 */

/** Address fields whose change re-queues a listing for re-approval. */
export const ADDRESS_FIELDS = ["fullAddress", "pincode", "latitude", "longitude"] as const;

/** All listing-field changes that re-queue for approval: an address change OR a
 *  visibility (distribution-channel) change. A CORPORATE_ONLY/BOTH re-tag must be
 *  admin-approved, so it flows through the SAME approval queue as PG address edits. */
export const REQUEUE_FIELDS = [...ADDRESS_FIELDS, "visibility"] as const;

/** A rent change strictly greater than this fraction re-queues for approval. */
export const RENT_REQUEUE_THRESHOLD = 0.2;

/** Snapshot of the listing fields an edit can touch (the "before" values). */
export type ListingEditable = Partial<
  Record<keyof UpdateHostListingInput, string | number | boolean | string[] | null>
>;

function valueChanged(before: unknown, after: unknown): boolean {
  if (Array.isArray(before) || Array.isArray(after)) {
    return JSON.stringify(before ?? []) !== JSON.stringify(after ?? []);
  }
  return before !== after;
}

export interface EditClassification {
  /** Field names whose value actually changed (a no-op patch reports none). */
  changedFields: string[];
  /** True when the change must re-queue the listing for approval. */
  requeue: boolean;
}

/**
 * Classify a listing-field edit. Only keys present in `patch` are considered, and
 * only those whose value DIFFERS from `before` count as changed (so resubmitting
 * the same value is a no-op, never a needless re-queue).
 */
export function classifyListingEdit(before: ListingEditable, patch: UpdateHostListingInput): EditClassification {
  const changedFields: string[] = [];
  for (const key of Object.keys(patch) as (keyof UpdateHostListingInput)[]) {
    if (valueChanged(before[key], patch[key])) changedFields.push(key);
  }
  const requeue = changedFields.some((f) => (REQUEUE_FIELDS as readonly string[]).includes(f));
  return { changedFields, requeue };
}

/**
 * Does a monthly-rent change exceed the 20% re-queue threshold? A move OFF zero
 * (an unpriced room becoming priced) is always significant; otherwise it is the
 * relative delta against the old rent.
 */
export function isRentChangeSignificant(beforePaise: number, afterPaise: number): boolean {
  if (beforePaise <= 0) return afterPaise > 0;
  return Math.abs(afterPaise - beforePaise) / beforePaise > RENT_REQUEUE_THRESHOLD;
}

/** Classify a room edit: which fields changed and whether the rent move re-queues. */
export function classifyRoomEdit(
  before: { name: string; floor: number | null; sharingType: number; monthlyRentPaise: number; depositPaise: number },
  patch: UpdateHostRoomInput,
): EditClassification {
  const changedFields: string[] = [];
  for (const key of Object.keys(patch) as (keyof UpdateHostRoomInput)[]) {
    if (valueChanged(before[key], patch[key])) changedFields.push(key);
  }
  const requeue =
    patch.monthlyRentPaise !== undefined &&
    changedFields.includes("monthlyRentPaise") &&
    isRentChangeSignificant(before.monthlyRentPaise, patch.monthlyRentPaise);
  return { changedFields, requeue };
}
