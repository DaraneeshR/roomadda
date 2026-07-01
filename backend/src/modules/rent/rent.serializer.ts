import type { RentInvoice } from "@prisma/client";
import type { RentInvoice as RentInvoiceDTO } from "@roomadda/shared";
import { effectiveRentStatus, periodLabel, rentOverdueDays } from "./rent.logic.js";

/**
 * Rent invoice serializer. `status` is the EFFECTIVE status computed at read time
 * (PAID / OVERDUE / DUE), so the API is correct even before the overdue sweep
 * runs. Carries no Razorpay/webhook internals — payment truth stays server-side.
 */
export function toRentInvoice(inv: RentInvoice, now: Date): RentInvoiceDTO {
  const status = effectiveRentStatus(inv.status, inv.dueDate, now);
  return {
    id: inv.id,
    bookingId: inv.bookingId,
    periodMonth: inv.periodMonth.toISOString(),
    periodLabel: periodLabel(inv.periodMonth),
    amountPaise: inv.amountPaise,
    dueDate: inv.dueDate.toISOString(),
    status,
    daysOverdue: status === "OVERDUE" ? rentOverdueDays(inv.dueDate, now) : 0,
    paidAt: inv.paidAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  };
}
