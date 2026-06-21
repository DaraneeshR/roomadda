import type { Prisma } from "@prisma/client";

export interface SettlementResult {
  onlinePaise: number;
  cashPaise: number;
  totalPaise: number;
  settled: boolean;
  confirmed: boolean;
}

/**
 * Recompute settlement for a booking, inside an existing transaction.
 *
 * This is the ONLY place a booking becomes CONFIRMED and a bed becomes BOOKED
 * (see /CLAUDE.md: payment truth = verified webhook / reconciliation). It is
 * idempotent — re-running on an already-confirmed booking is a no-op — so it is
 * safe to call from the webhook handler and from cash collect/reconcile.
 */
export async function settleBookingTx(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<SettlementResult> {
  const booking = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    return { onlinePaise: 0, cashPaise: 0, totalPaise: 0, settled: false, confirmed: false };
  }

  const capturedAgg = await tx.paymentTransaction.aggregate({
    _sum: { amountPaise: true },
    where: { status: "CAPTURED", payment: { bookingId } },
  });
  const cashAgg = await tx.cashCollection.aggregate({
    _sum: { amountPaise: true },
    where: { bookingId, status: { in: ["COLLECTED", "RECONCILED"] } },
  });

  const onlinePaise = capturedAgg._sum.amountPaise ?? 0;
  const cashPaise = cashAgg._sum.amountPaise ?? 0;
  const totalPaise = onlinePaise + cashPaise;
  const settled = totalPaise >= booking.tokenAmountPaise;

  await tx.payment.updateMany({
    where: { bookingId },
    data: { status: settled ? "CAPTURED" : onlinePaise > 0 ? "AUTHORIZED" : "CREATED" },
  });

  let confirmed = false;
  // Only confirm a booking that is still on hold; never re-confirm or resurrect
  // an EXPIRED/CANCELLED booking.
  if (settled && booking.status === "TOKEN_PENDING") {
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    await tx.bed.update({ where: { id: booking.bedId }, data: { status: "BOOKED" } });
    confirmed = true;
  }

  return { onlinePaise, cashPaise, totalPaise, settled, confirmed };
}
