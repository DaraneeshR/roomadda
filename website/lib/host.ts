import type { GenderPolicy, HostListing, ListingStatus } from "@roomadda/shared";

/**
 * Framework-free logic for the web host portal. Everything the portal *decides*
 * about a listing — whether it can be submitted for review, whether an edit will
 * re-queue it for approval, how to label a lifecycle state — lives here as pure
 * functions so it is unit-tested without a DOM and can never drift into ad-hoc
 * component code.
 *
 * These mirror the backend's authorities (the §9.2 go-live gate and the
 * edit-classify rules) so the UI can WARN up-front, but the server stays the sole
 * enforcer: the create form gate below only shapes the UI; the admin publish path
 * re-checks the same gate, and the host edit endpoint returns the real `requeued`.
 * Money is display-only here — nothing in this module computes an amount.
 */

/** PRD §9.2: a listing needs at least this many photos before it can go live. */
export const MIN_PUBLISH_PHOTOS = 5;

/** A room's monthly-rent change strictly beyond this fraction re-queues for approval. */
export const RENT_REQUEUE_THRESHOLD = 0.2;

/** Address fields whose change re-queues a LIVE listing for re-approval. */
export const ADDRESS_FIELDS = ["fullAddress", "pincode", "latitude", "longitude"] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

/** The go-live conditions the client can check before submitting for review. */
export interface SubmitReadiness {
  photoCount: number;
  hasPricedRoom: boolean;
}

/** Which go-live conditions are unmet, in the order the form should surface them. */
export type SubmitGate = "photos" | "rooms";

/**
 * Which §9.2 conditions the host still needs to satisfy before submitting a draft
 * to the admin queue. The client checks the two conditions it can see (photos +
 * a priced room); the host's KYC is the third gate but is enforced by admin at
 * publish, so it is not blocked here. An empty array means "ready to submit".
 */
export function missingSubmitGates(r: SubmitReadiness): SubmitGate[] {
  const missing: SubmitGate[] = [];
  if (r.photoCount < MIN_PUBLISH_PHOTOS) missing.push("photos");
  if (!r.hasPricedRoom) missing.push("rooms");
  return missing;
}

/** How many more photos are needed to satisfy the min-5 gate (0 when satisfied). */
export function photosStillNeeded(photoCount: number): number {
  return Math.max(0, MIN_PUBLISH_PHOTOS - photoCount);
}

/** True when a listing has at least one room priced above zero paise. */
export function hasPricedRoom(listing: Pick<HostListing, "rooms">): boolean {
  return listing.rooms.some((r) => r.monthlyRentPaise > 0);
}

/** A listing is submittable to the admin queue once both visible gates pass. */
export function canSubmitForReview(r: SubmitReadiness): boolean {
  return missingSubmitGates(r).length === 0;
}

/**
 * Will editing these listing fields re-queue a LIVE listing for approval? Mirrors
 * the backend classifier: an ADDRESS change re-queues. Only a change that differs
 * from the current value counts, so re-saving the same address is not a re-queue.
 * (Applies only to a PUBLISHED listing — a draft just edits.)
 */
export function listingEditWillRequeue(
  before: Partial<Record<AddressField, string | number>>,
  after: Partial<Record<AddressField, string | number>>,
): boolean {
  return ADDRESS_FIELDS.some((f) => f in after && after[f] !== before[f]);
}

/**
 * Does a monthly-rent change exceed the 20% re-queue threshold? Mirrors the
 * backend: a move OFF zero (unpriced → priced) is always significant; otherwise
 * it is the relative delta against the old rent.
 */
export function isRentChangeSignificant(beforePaise: number, afterPaise: number): boolean {
  if (beforePaise <= 0) return afterPaise > 0;
  return Math.abs(afterPaise - beforePaise) / beforePaise > RENT_REQUEUE_THRESHOLD;
}

/** A listing's lifecycle state as shown to the host, folding in the pause flag. */
export type HostListingState = "LIVE" | "PAUSED" | "DRAFT" | "IN_REVIEW" | "SUSPENDED";

/** Fold a listing's status + pause flag into one host-facing lifecycle state. */
export function listingState(listing: Pick<HostListing, "status" | "paused">): HostListingState {
  if (listing.status === "PUBLISHED") return listing.paused ? "PAUSED" : "LIVE";
  if (listing.status === "DRAFT") return "DRAFT";
  if (listing.status === "PENDING_REVIEW") return "IN_REVIEW";
  return "SUSPENDED";
}

/** Human label for a lifecycle state. */
export function listingStateLabel(state: HostListingState): string {
  const labels: Record<HostListingState, string> = {
    LIVE: "Live",
    PAUSED: "Paused",
    DRAFT: "Draft",
    IN_REVIEW: "In review",
    SUSPENDED: "Suspended",
  };
  return labels[state];
}

/** Tailwind pill classes per lifecycle state (kept beside the labels). */
export function listingStateClasses(state: HostListingState): string {
  const styles: Record<HostListingState, string> = {
    LIVE: "bg-green-100 text-green-800",
    PAUSED: "bg-amber-100 text-amber-800",
    DRAFT: "bg-slate-100 text-slate-600",
    IN_REVIEW: "bg-sky-100 text-sky-800",
    SUSPENDED: "bg-red-100 text-red-800",
  };
  return styles[state];
}

/** Occupancy rollup across a listing's rooms (beds occupied by any live use). */
export interface Occupancy {
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  /** 0–100, rounded; 0 when there are no beds. */
  percent: number;
}

/** Sum bed occupancy across a listing's rooms (booked + walk-in + held = occupied). */
export function listingOccupancy(listing: Pick<HostListing, "rooms">): Occupancy {
  let totalBeds = 0;
  let availableBeds = 0;
  for (const room of listing.rooms) {
    totalBeds += room.totalBeds;
    availableBeds += room.availableBeds;
  }
  const occupiedBeds = totalBeds - availableBeds;
  const percent = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
  return { totalBeds, occupiedBeds, availableBeds, percent };
}

/** Whether a listing status may be paused/unpaused (only a live listing). */
export function canTogglePause(status: ListingStatus): boolean {
  return status === "PUBLISHED";
}

/**
 * The host-portal access decision, as a pure function so the gate is unit-tested
 * without a DOM. Given the session status and the user's role:
 *   - "loading"   → session still bootstrapping (show a skeleton),
 *   - "anonymous" → no session (prompt in-place login),
 *   - "forbidden" → authenticated but NOT a host (redirect away to discovery),
 *   - "allowed"   → a HOST (render the portal).
 * The backend still re-checks the role on every /api/host/* call — this only
 * shapes the UI so a non-host never sees host chrome.
 */
export type HostAccess = "loading" | "anonymous" | "forbidden" | "allowed";

export function hostAccess(
  status: "loading" | "authenticated" | "anonymous",
  role: string | null | undefined,
): HostAccess {
  if (status === "loading") return "loading";
  if (status === "anonymous") return "anonymous";
  return role === "HOST" ? "allowed" : "forbidden";
}

/** Human label for a listing's gender policy. */
export function genderPolicyLabel(gender: GenderPolicy): string {
  const labels: Record<GenderPolicy, string> = {
    MALE: "Men only",
    FEMALE: "Women only",
    COED: "Co-ed",
  };
  return labels[gender];
}
