/**
 * Cancellation refund policy (PRD §8.4 / /CLAUDE.md), applied automatically from
 * the cancellation timestamp vs the move-in date. Pure so it is unit-tested
 * without a DB or clock.
 *
 *  - Nothing was captured yet (not CONFIRMED) → nothing to refund.
 *  - CONFIRMED and cancelled MORE than 7 days before move-in → full refund.
 *  - CONFIRMED and cancelled 3–7 days before move-in → 50% refund.
 *  - CONFIRMED and within 3 days of move-in → no refund.
 *  - CONFIRMED with no move-in date set → treat as full refund.
 */
export function computeRefundPaise(input: {
  status: string;
  tokenAmountPaise: number;
  moveInDate: Date | null;
  now: Date;
}): number {
  if (input.status !== "CONFIRMED") return 0;
  const token = input.tokenAmountPaise;
  if (!input.moveInDate) return token;
  const days = (input.moveInDate.getTime() - input.now.getTime()) / (24 * 60 * 60 * 1000);
  if (days > 7) return token;
  if (days >= 3) return Math.round(token / 2);
  return 0;
}
