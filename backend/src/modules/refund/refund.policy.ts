import type { CancelledBy } from "@roomadda/shared";

/**
 * Cancellation refund policy (/CLAUDE.md domain rule #2, PRD §8.4). PURE: no I/O,
 * no clock — the caller passes `now` and `moveInDate`, so it is exhaustively
 * unit-tested at the day boundaries.
 *
 * Rules (decided server-side from the cancellation timestamp vs the move-in date):
 *   - HOST declines OR SYSTEM (PG unavailable)  -> FULL refund, whatever the date.
 *   - TENANT, more than 7 days before move-in   -> FULL refund.
 *   - TENANT, 3–7 days before move-in inclusive -> 50% refund.
 *   - TENANT, less than 3 days before move-in   -> NO refund.
 *   - TENANT with no move-in date set           -> FULL refund (nothing to count
 *     down to; never penalise the tenant for a date that was never chosen).
 *
 * Rounding: a 50% refund is rounded DOWN to whole paise (`Math.floor`) so the
 * platform never refunds MORE than the entitled fraction. Money is integer paise
 * (/CLAUDE.md domain rule #1) — there are no fractional paise.
 *
 * NOTE: this returns the policy-ENTITLED amount only. Whether anything is
 * actually refundable (i.e. a token was captured online) is decided by the
 * cancellation service, not here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const FULL_REFUND_DAYS = 7; // strictly more than this -> full
const PARTIAL_REFUND_DAYS = 3; // at least this (and <= 7) -> 50%

/** Machine-stable reason codes — surfaced in the cancel response + audit log. */
export const REFUND_REASONS = {
  hostCancelled: "host_cancelled",
  pgUnavailable: "pg_unavailable",
  fullWindow: "full_refund_window",
  partialWindow: "partial_refund_window",
  noWindow: "no_refund_window",
} as const;

export interface RefundPolicyInput {
  tokenPaise: number;
  moveInDate: Date | null;
  now: Date;
  cancelledBy: CancelledBy;
}

export interface RefundDecision {
  refundPaise: number;
  reason: string;
}

export function computeRefundPaise(input: RefundPolicyInput): RefundDecision {
  const { tokenPaise, moveInDate, now, cancelledBy } = input;

  // Host decline / PG-unavailable always refund in full, regardless of timing.
  if (cancelledBy === "HOST") return { refundPaise: tokenPaise, reason: REFUND_REASONS.hostCancelled };
  if (cancelledBy === "SYSTEM") return { refundPaise: tokenPaise, reason: REFUND_REASONS.pgUnavailable };

  // Tenant-initiated: tiered by days from `now` to move-in.
  if (!moveInDate) return { refundPaise: tokenPaise, reason: REFUND_REASONS.fullWindow };

  const days = (moveInDate.getTime() - now.getTime()) / DAY_MS;
  if (days > FULL_REFUND_DAYS) return { refundPaise: tokenPaise, reason: REFUND_REASONS.fullWindow };
  if (days >= PARTIAL_REFUND_DAYS) {
    return { refundPaise: Math.floor(tokenPaise / 2), reason: REFUND_REASONS.partialWindow };
  }
  return { refundPaise: 0, reason: REFUND_REASONS.noWindow };
}
