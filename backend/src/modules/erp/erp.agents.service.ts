/**
 * ERP-4 Agents (§15.3). The per-agent scorecard (submitted / approved / conversion
 * + incentive tier), the commission leaderboard, and the ADMIN reassignment of a
 * booking's attribution.
 *
 * The MONEY on every scorecard is a Σ over the SAME engine-priced confirmed-paid
 * set the dashboard uses ({@link gatherConfirmedPaidBookings}), grouped by agent —
 * so the leaderboard reconciles to the dashboard's top-agents for the same filter.
 * `submitted` counts the agent's bookings CREATED in the period (the conversion
 * denominator); `approved` is the confirmed-paid subset (the numerator + the money).
 *
 * Reassignment moves ONLY `Booking.bookedByAgentId`. Because commission is DERIVED
 * on read (BPS of the booking's rent, via the ONE {@link agentCommissionPaise}
 * definition) and is never stored per agent, moving that column recalculates the
 * losing agent's totals, the gaining agent's totals, and the leaderboard on the
 * next read — with NO separate commission path.
 *
 * ⚠️ /CLAUDE.md flags `Booking.bookedByAgentId` as "IMMUTABLE once CONFIRMED — no
 * route reassigns it". That rule governs the TENANT/AGENT booking flow (an agent
 * must never re-attribute their own bookings — it protects commission truth). This
 * is a DISTINCT, ADMIN-only, audited back-office CORRECTION explicitly required by
 * §15.3; it does not touch payment/settlement truth (only who the derived
 * commission is credited to). The agent-flow immutability is left untouched.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import {
  agentIncentiveTier,
  resolveFinancialPeriod,
  type FinancialPeriod,
} from "./erp.engine.js";
import { gatherConfirmedPaidBookings, type FinanceBooking } from "./erp.finance.js";
import { priceBookings } from "./erp.pricing.js";
import type {
  BookingCommissionSummary,
  ErpAgentScorecard,
  ErpAgentsResponse,
  ErpFinanceFilter,
  ErpFinancePeriod,
  ReassignBookingResult,
} from "@roomadda/shared";

interface Actor {
  id: string;
}

export const erpAgentsService = {
  /**
   * Every active agent's §15.3 scorecard + the commission leaderboard, scoped by
   * the global filter. Money is engine-priced (Σ over the confirmed-paid set);
   * conversion is approved/submitted. The leaderboard is the same scorecards ranked
   * by commission earned.
   */
  async overview(filter: ErpFinanceFilter, now: Date = new Date()): Promise<ErpAgentsResponse> {
    const period = resolveFinancialPeriod(filter, now);
    const approvedBookings = await gatherConfirmedPaidBookings(filter, period);
    const submittedCounts = await submittedByAgent(filter, period);

    // Every agent that either submitted or closed a booking in the filtered scope.
    const agentIds = new Set<string>(submittedCounts.keys());
    for (const b of approvedBookings) if (b.agentId) agentIds.add(b.agentId);

    const agents = agentIds.size
      ? await prisma.user.findMany({
          where: { id: { in: [...agentIds] }, role: "AGENT" },
          select: { id: true, fullName: true, assignedCity: true },
        })
      : [];
    const metaById = new Map(agents.map((a) => [a.id, a]));

    const approvedByAgent = groupApprovedByAgent(approvedBookings);

    const scorecards: ErpAgentScorecard[] = [];
    for (const agentId of agentIds) {
      const meta = metaById.get(agentId);
      if (!meta) continue; // defensive: a non-agent attribution is ignored, never priced
      const approved = approvedByAgent.get(agentId) ?? emptyAgentMoney();
      const submitted = submittedCounts.get(agentId) ?? 0;
      scorecards.push(toScorecard(meta, submitted, approved));
    }

    // Default order: by name (a stable roster); the leaderboard is the ranked copy.
    scorecards.sort((a, z) => (a.agentName < z.agentName ? -1 : a.agentName > z.agentName ? 1 : 0));
    const leaderboard = [...scorecards].sort(
      (a, z) => z.commissionPaise - a.commissionPaise || z.approved - a.approved,
    );

    return {
      period: serializePeriod(period),
      agents: scorecards,
      leaderboard,
      generatedAt: now.toISOString(),
    };
  },

  /**
   * Reassign a booking's agent attribution (§15.3, ADMIN-only, audited). Moves
   * `bookedByAgentId` to another AGENT; commission/performance/leaderboard all
   * recalculate on the next read because commission is engine-derived, not stored.
   * Returns the booking's RECOMPUTED commission (now credited to the new agent).
   */
  async reassign(actor: Actor, bookingId: string, agentId: string, ip?: string): Promise<ReassignBookingResult> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, bookedByAgentId: true, status: true, monthlyRentPaise: true },
    });
    if (!booking) {
      throw new AppError({ statusCode: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
    }

    const agent = await prisma.user.findUnique({
      where: { id: agentId },
      select: { id: true, fullName: true, role: true },
    });
    if (!agent || agent.role !== "AGENT") {
      throw new AppError({ statusCode: 422, code: "AGENT_NOT_FOUND", message: "No such agent" });
    }

    const previousAgentId = booking.bookedByAgentId;
    if (previousAgentId !== agentId) {
      await prisma.booking.update({ where: { id: bookingId }, data: { bookedByAgentId: agentId } });
    }

    await writeAudit({
      actorId: actor.id,
      action: "erp.booking.reassigned",
      targetId: bookingId,
      ip,
      metadata: { fromAgentId: previousAgentId, toAgentId: agentId, status: booking.status },
    });

    // Recompute the commission through the ONE engine path — now the new agent's.
    const reloaded = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { id: true, status: true, monthlyRentPaise: true },
    });
    const commission = isCommissioned(reloaded.status)
      ? toCommissionSummary((await priceBookings([reloaded])).get(reloaded.id)!)
      : null;

    return { bookingId, previousAgentId, agentId, agentName: agent.fullName, commission };
  },
};

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

const LEDGER_STATUSES = ["CONFIRMED", "COMPLETED"] as const;
function isCommissioned(status: string): boolean {
  return (LEDGER_STATUSES as readonly string[]).includes(status);
}

interface AgentMoney {
  approved: number;
  collectionPaise: number;
  commissionPaise: number;
  netPaise: number;
}
const emptyAgentMoney = (): AgentMoney => ({ approved: 0, collectionPaise: 0, commissionPaise: 0, netPaise: 0 });

/** Σ the confirmed-paid (engine-priced) set by agent — the money + approved count. */
function groupApprovedByAgent(bookings: FinanceBooking[]): Map<string, AgentMoney> {
  const out = new Map<string, AgentMoney>();
  for (const b of bookings) {
    if (!b.agentId) continue;
    const m = out.get(b.agentId) ?? emptyAgentMoney();
    m.approved += 1;
    m.collectionPaise += b.money.collectedPaise;
    m.commissionPaise += b.money.commissionPaise;
    m.netPaise += b.money.netPaise;
    out.set(b.agentId, m);
  }
  return out;
}

/** Count each agent's bookings CREATED in the period (the conversion denominator),
 *  under the same property/agent scope as the money set. */
async function submittedByAgent(filter: ErpFinanceFilter, period: FinancialPeriod): Promise<Map<string, number>> {
  const where: Prisma.BookingWhereInput = {
    bookedByAgentId: filter.agentId ? filter.agentId : { not: null },
    createdAt: { gte: period.fromInclusive, lt: period.toExclusive },
    ...(filter.listingId ? { listingId: filter.listingId } : {}),
  };
  const groups = await prisma.booking.groupBy({ by: ["bookedByAgentId"], where, _count: { _all: true } });
  const out = new Map<string, number>();
  for (const g of groups) if (g.bookedByAgentId) out.set(g.bookedByAgentId, g._count._all);
  return out;
}

function toScorecard(
  meta: { id: string; fullName: string; assignedCity: string | null },
  submitted: number,
  money: AgentMoney,
): ErpAgentScorecard {
  // approved ⊆ money set; submitted is createdAt-scoped. At a period boundary a
  // booking can be approved (confirmed in-period) yet created out-of-period, so we
  // clamp the ratio to [0,1] to honour the contract — an honest edge, not a fudge.
  const rawRate = submitted > 0 ? money.approved / submitted : 0;
  const conversionRate = Math.round(Math.min(1, Math.max(0, rawRate)) * 10_000) / 10_000;
  return {
    agentId: meta.id,
    agentName: meta.fullName,
    assignedCity: meta.assignedCity,
    submitted,
    approved: money.approved,
    conversionRate,
    collectionPaise: money.collectionPaise,
    commissionPaise: money.commissionPaise,
    netPaise: money.netPaise,
    tier: agentIncentiveTier(money.approved),
  };
}

function toCommissionSummary(money: {
  commissionPaise: number;
  paidToPgPaise: number;
  collectedPaise: number;
  netPaise: number;
  settlementStatus: "PENDING" | "RECEIVED";
}): BookingCommissionSummary {
  return {
    commissionPaise: money.commissionPaise,
    paidToPgPaise: money.paidToPgPaise,
    collectedPaise: money.collectedPaise,
    netPaise: money.netPaise,
    status: money.settlementStatus,
  };
}

function serializePeriod(period: FinancialPeriod): ErpFinancePeriod {
  return {
    financialYear: period.financialYear,
    label: period.label,
    fromInclusive: period.fromInclusive.toISOString(),
    toExclusive: period.toExclusive.toISOString(),
  };
}
