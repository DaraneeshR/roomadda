import type { RevenueMonth, RevenueSummary } from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";

/**
 * Read-only revenue snapshot for a host listing (NO payouts in MVP). All figures
 * are integer paise. Expected/collected are the CURRENT month's rent invoices and
 * their PAID subset; overdue is every unpaid past-due invoice. Occupancy counts
 * live beds. A last-3-months series powers the chart. An invoice is PAID only via
 * the verified webhook (/CLAUDE.md) — this only READS the persisted state.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function monthLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

interface InvoiceRow {
  amountPaise: number;
  status: string;
  dueDate: Date;
  paidAt: Date | null;
  periodMonth: Date;
}

const isPaid = (inv: InvoiceRow): boolean => inv.status === "PAID" || inv.paidAt !== null;

export const revenueService = {
  async summary(listingId: string, now: Date = new Date()): Promise<RevenueSummary> {
    const [invoices, beds] = await Promise.all([
      prisma.rentInvoice.findMany({
        where: { booking: { listingId } },
        select: { amountPaise: true, status: true, dueDate: true, paidAt: true, periodMonth: true },
      }),
      prisma.bed.findMany({ where: { room: { listingId } }, select: { status: true } }),
    ]);

    const currentKey = monthKey(startOfUtcMonth(now));
    let expectedPaise = 0;
    let collectedPaise = 0;
    let overduePaise = 0;
    for (const inv of invoices) {
      const inCurrent = monthKey(inv.periodMonth) === currentKey;
      if (inCurrent) {
        expectedPaise += inv.amountPaise;
        if (isPaid(inv)) collectedPaise += inv.amountPaise;
      }
      if (!isPaid(inv) && inv.dueDate.getTime() < now.getTime()) overduePaise += inv.amountPaise;
    }

    // Last 3 months (oldest first) for the chart.
    const months: RevenueMonth[] = [];
    for (let back = 2; back >= 0; back--) {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const key = monthKey(monthStart);
      let expected = 0;
      let collected = 0;
      for (const inv of invoices) {
        if (monthKey(inv.periodMonth) !== key) continue;
        expected += inv.amountPaise;
        if (isPaid(inv)) collected += inv.amountPaise;
      }
      months.push({ periodMonth: monthStart.toISOString(), periodLabel: monthLabel(monthStart), expectedPaise: expected, collectedPaise: collected });
    }

    const totalBeds = beds.length;
    const vacantBeds = beds.filter((b) => b.status === "AVAILABLE").length;
    const occupiedBeds = totalBeds - vacantBeds; // BOOKED + BLOCKED + HELD

    return {
      listingId,
      expectedPaise,
      collectedPaise,
      overduePaise,
      occupiedBeds,
      vacantBeds,
      totalBeds,
      months,
      generatedAt: now.toISOString(),
    };
  },
};
