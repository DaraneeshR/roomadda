/**
 * ERP-6 — the scoped, mobile-first AGENT ERP view (§15.4). An agent sees ONLY
 * their OWN work: their bookings, the GROSS commission THEY earned, their
 * performance and their leaderboard rank. It NEVER exposes another agent's data,
 * nor any company-finance figure (owner payouts, collections, net, settlements).
 *
 * The privacy invariant is enforced two ways, belt-and-braces:
 *  1. STRUCTURAL — this module imports ONLY {@link agentCommissionPaise} (the one
 *     engine definition of an agent's commission) and NEVER {@link priceBookings}.
 *     It therefore cannot even compute `collected` / `paidToPg` / `net` /
 *     settlement, so no company-finance figure can leak through a serializer slip.
 *  2. SCOPING — every read is filtered by `bookedByAgentId = caller` (self); the
 *     booking detail additionally asserts the property is in the agent's zone
 *     (§9.1), and a submission's bed/room must be in-zone. A cross-agent or
 *     cross-zone id is a 404 — indistinguishable from a missing one.
 *
 * Commission is the SAME `agentCommissionPaise` the ERP ledger uses, so the agent's
 * figure can never disagree with the admin's. Money is integer paise.
 */
import { randomUUID } from "node:crypto";
import { Prisma, type Booking } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { objectStorage, type PresignedUpload } from "../../lib/storage.js";
import { env } from "../../config/env.js";
import { agentCommissionPaise, agentIncentiveTier, approvalStatusOf } from "../erp/erp.engine.js";
import { assertBedInZone, assertListingInZone, assertRoomInZone } from "./zone.js";
import type {
  AgentErpBookingDetail,
  AgentErpBookingRow,
  AgentErpBookingsResponse,
  AgentErpHome,
  AgentErpPerformance,
  AgentErpUploadPurpose,
  AgentErpUploadUrlResponse,
  AgentErpBookingsQuery,
  AgentSubmitBookingInput,
  AgentSubmitBookingResult,
  BookingKycDocument,
} from "@roomadda/shared";

/** Confirmed-paid statuses carry commission (mirrors LEDGER_BOOKING_STATUSES). */
const COMMISSIONED_STATUSES = ["CONFIRMED", "COMPLETED"] as const;
const isCommissioned = (status: string): boolean =>
  (COMMISSIONED_STATUSES as readonly string[]).includes(status);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const notFound = (): AppError => new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Not found" });

/** Gross commission on one booking — the ONE engine definition, never re-derived. */
function commissionFor(monthlyRentPaise: number): number {
  return agentCommissionPaise(monthlyRentPaise, env.AGENT_COMMISSION_BPS);
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfNextUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** The booking columns the agent ledger row needs (NO company-finance columns). */
const rowInclude = {
  tenant: { select: { fullName: true } },
  listing: { select: { alias: true } },
} satisfies Prisma.BookingInclude;
type RowBooking = Prisma.BookingGetPayload<{ include: typeof rowInclude }>;

export const agentErpService = {
  /** The month snapshot: my bookings / approved / commission / rank (own data only). */
  async home(agentId: string, now: Date = new Date()): Promise<AgentErpHome> {
    const monthStart = startOfUtcMonth(now);
    const monthEnd = startOfNextUtcMonth(now);

    const [bookingCount, confirmed, rank] = await Promise.all([
      prisma.booking.count({ where: { bookedByAgentId: agentId, createdAt: { gte: monthStart, lt: monthEnd } } }),
      prisma.booking.findMany({
        where: { bookedByAgentId: agentId, status: { in: [...COMMISSIONED_STATUSES] }, confirmedAt: { gte: monthStart, lt: monthEnd } },
        select: { monthlyRentPaise: true },
      }),
      monthlyRank(agentId, monthStart, monthEnd),
    ]);

    const commissionEarnedPaise = confirmed.reduce((s, b) => s + commissionFor(b.monthlyRentPaise), 0);
    return {
      periodMonth: monthStart.toISOString(),
      periodLabel: `${MONTHS[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
      bookingCount,
      approvedCount: confirmed.length,
      commissionEarnedPaise,
      rank: rank.rank,
      totalAgents: rank.totalAgents,
      generatedAt: now.toISOString(),
    };
  },

  /** The agent's OWN bookings ledger (self-scoped), each with the gross commission
   *  they earned. Cursor-paginated; no company-finance fields anywhere. */
  async listBookings(agentId: string, query: AgentErpBookingsQuery): Promise<AgentErpBookingsResponse> {
    const rows = await prisma.booking.findMany({
      where: { bookedByAgentId: agentId, ...approvalFilter(query.approval) },
      include: rowInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = (hasMore ? rows.slice(0, query.limit) : rows).map(toRow);
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? last.bookingId : null };
  },

  /**
   * One of the agent's OWN bookings in full (self + zone; 404 otherwise). Surfaces
   * the customer, listing (unmasked — the agent is privileged in-zone), room, stay,
   * the gross commission earned, and the KYC docs + payment proof as SHORT-LIVED
   * signed URLs. Viewing the documents is audited as a PII access.
   */
  async bookingDetail(agentId: string, agentCity: string, bookingId: string, ip?: string): Promise<AgentErpBookingDetail> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        tenant: { select: { id: true, fullName: true, phone: true } },
        listing: { select: { id: true, alias: true, actualName: true, areaLabel: true, city: true } },
        bed: { select: { id: true, label: true, room: { select: { name: true } } } },
      },
    });
    // Self first (cross-agent → 404), then zone (§9.1 → 404). Either miss leaks nothing.
    if (!booking || booking.bookedByAgentId !== agentId) throw notFound();
    await assertListingInZone(agentCity, booking.listingId);

    const kyc = await buildKycBlock(booking.tenantId);
    if ((kyc && kyc.documents.length > 0) || booking.paymentProofKey) {
      await writeAudit({
        actorId: agentId,
        action: "agent.erp.docs.viewed",
        targetId: bookingId,
        ip,
        metadata: { userId: booking.tenantId, documentCount: kyc?.documents.length ?? 0, hasPaymentProof: booking.paymentProofKey !== null },
      });
    }

    const paymentProof = booking.paymentProofKey
      ? { url: await objectStorage.presignDownload(booking.paymentProofKey), expiresInSeconds: env.KYC_UPLOAD_URL_TTL_SECONDS }
      : null;

    return {
      bookingId: booking.id,
      approval: approvalStatusOf(booking.status, booking.cancelledBy),
      bookingStatus: booking.status,
      agentChannel: booking.agentChannel,
      createdAt: booking.createdAt.toISOString(),
      confirmedAt: booking.confirmedAt?.toISOString() ?? null,
      moveInDate: booking.moveInDate?.toISOString() ?? null,
      customer: { fullName: booking.tenant.fullName, phone: booking.tenant.phone ?? "" },
      listing: {
        listingId: booking.listing.id,
        alias: booking.listing.alias,
        actualName: booking.listing.actualName,
        areaLabel: booking.listing.areaLabel,
        city: booking.listing.city,
      },
      room: { bedId: booking.bed.id, bedLabel: booking.bed.label, roomName: booking.bed.room.name },
      stay: {
        monthlyRentPaise: booking.monthlyRentPaise,
        depositPaise: booking.depositPaise,
        tokenAmountPaise: booking.tokenAmountPaise,
        moveInDate: booking.moveInDate?.toISOString() ?? null,
      },
      commissionEarnedPaise: isCommissioned(booking.status) ? commissionFor(booking.monthlyRentPaise) : null,
      kyc,
      paymentProof,
    };
  },

  /** The agent's scorecard: totals, conversion %, commission, incentive tier, rank. */
  async performance(agentId: string, agentCity: string, now: Date = new Date()): Promise<AgentErpPerformance> {
    const monthStart = startOfUtcMonth(now);
    const monthEnd = startOfNextUtcMonth(now);

    const [submitted, confirmed, visitsCompleted, rank] = await Promise.all([
      prisma.booking.count({ where: { bookedByAgentId: agentId, createdAt: { gte: monthStart, lt: monthEnd } } }),
      prisma.booking.findMany({
        where: { bookedByAgentId: agentId, status: { in: [...COMMISSIONED_STATUSES] }, confirmedAt: { gte: monthStart, lt: monthEnd } },
        select: { monthlyRentPaise: true },
      }),
      prisma.agentVisit.count({
        where: { agentId, status: "COMPLETED", visitedAt: { gte: monthStart, lt: monthEnd }, listing: { city: { equals: agentCity, mode: "insensitive" } } },
      }),
      monthlyRank(agentId, monthStart, monthEnd),
    ]);

    const approved = confirmed.length;
    const commissionEarnedPaise = confirmed.reduce((s, b) => s + commissionFor(b.monthlyRentPaise), 0);
    const conversionRate = submitted > 0 ? Math.round(Math.min(1, approved / submitted) * 10_000) / 10_000 : 0;

    return {
      periodMonth: monthStart.toISOString(),
      periodLabel: `${MONTHS[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
      submitted,
      approved,
      conversionRate,
      visitsCompleted,
      commissionEarnedPaise,
      tier: agentIncentiveTier(approved),
      rank: rank.rank,
      totalAgents: rank.totalAgents,
      generatedAt: now.toISOString(),
    };
  },

  /** Presign a PUT URL for one KYC / payment-proof image (private bucket). */
  async presignUpload(agentId: string, purpose: AgentErpUploadPurpose, contentType: "image/jpeg" | "image/png"): Promise<AgentErpUploadUrlResponse> {
    const ext = contentType === "image/png" ? "png" : "jpg";
    const folder = purpose === "PAYMENT_PROOF" ? "payment-proof" : "kyc";
    const key = `agent-submissions/${agentId}/${folder}/${randomUUID()}.${ext}`;
    const presigned: PresignedUpload = await objectStorage.presignUpload({ key, contentType });
    return { key: presigned.key, url: presigned.uploadUrl, expiresInSeconds: presigned.expiresInSeconds };
  },

  /**
   * Submit an offline booking (§15.4): guest + property (in-zone) + stay + financial
   * + camera KYC + payment proof. Creates a PENDING_APPROVAL booking attributed to
   * the agent that flows into the SAME admin approval queue (ERP-2). The bed is
   * row-locked (the one-live-booking invariant holds), the guest's KYC is recorded,
   * and the payment-proof key is attached. NEVER confirms — payment truth is the
   * verified webhook. Audited.
   */
  async submit(agentId: string, agentCity: string, input: AgentSubmitBookingInput, ip?: string): Promise<AgentSubmitBookingResult> {
    // Zone gate: the target must be in the agent's city (§9.1) — 404 otherwise.
    const listing = input.bedId
      ? (await assertBedInZone(agentCity, input.bedId)).listing
      : (await assertRoomInZone(agentCity, input.roomId!)).listing;

    const tenant = await resolveTenantUser(input.tenantName, input.tenantPhone);
    const moveIn = new Date(input.moveInDate);

    let booking: Booking;
    try {
      booking = await prisma.$transaction(async (tx) => {
        // Row-lock the chosen bed (or an available bed in the room) and confirm it
        // is free — defence-in-depth alongside the partial unique index.
        const bed = input.bedId
          ? (await tx.$queryRaw<Array<{ id: string; status: string; roomId: string }>>`
              SELECT id, status::text AS status, "roomId" FROM beds WHERE id = ${input.bedId}::uuid FOR UPDATE
            `)[0]
          : (await tx.$queryRaw<Array<{ id: string; status: string; roomId: string }>>`
              SELECT id, status::text AS status, "roomId" FROM beds
              WHERE "roomId" = ${input.roomId}::uuid AND status = 'AVAILABLE'
              ORDER BY label LIMIT 1 FOR UPDATE
            `)[0];
        if (!bed) throw new AppError({ statusCode: input.bedId ? 404 : 409, code: input.bedId ? "BED_NOT_FOUND" : "NO_BED_AVAILABLE", message: input.bedId ? "Bed not found" : "No available bed in this room" });
        if (bed.status !== "AVAILABLE") {
          throw new AppError({ statusCode: 409, code: "BED_NOT_AVAILABLE", message: "Bed is not available" });
        }

        const created = await tx.booking.create({
          data: {
            bedId: bed.id,
            tenantId: tenant.id,
            listingId: listing.id,
            // PENDING_APPROVAL → lands in the shared admin approval queue (ERP-2).
            status: "PENDING_APPROVAL",
            tokenAmountPaise: input.tokenAmountPaise,
            monthlyRentPaise: input.monthlyRentPaise,
            depositPaise: input.depositPaise,
            moveInDate: moveIn,
            bookedByAgentId: agentId,
            agentChannel: input.agentChannel,
            paymentProofKey: input.paymentProofKey,
          },
        });
        await tx.bed.update({ where: { id: bed.id }, data: { status: "HELD" } });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({ statusCode: 409, code: "BED_NOT_AVAILABLE", message: "Bed is not available" });
      }
      throw err;
    }

    // Record the guest's camera KYC on their profile (admin review surfaces it).
    await prisma.kycRecord.upsert({
      where: { userId: tenant.id },
      create: {
        userId: tenant.id,
        status: "PENDING",
        docType: input.kyc.docType,
        aadhaarFrontKey: input.kyc.aadhaarFrontKey,
        aadhaarBackKey: input.kyc.aadhaarBackKey ?? null,
        supportingDocKey: input.kyc.supportingDocKey ?? null,
        supportingDocType: input.kyc.supportingDocType ?? null,
      },
      update: {
        docType: input.kyc.docType,
        aadhaarFrontKey: input.kyc.aadhaarFrontKey,
        aadhaarBackKey: input.kyc.aadhaarBackKey ?? null,
        supportingDocKey: input.kyc.supportingDocKey ?? null,
        supportingDocType: input.kyc.supportingDocType ?? null,
      },
    });

    await writeAudit({
      actorId: agentId,
      action: "agent.erp.submission.created",
      targetId: booking.id,
      ip,
      metadata: { tenantId: tenant.id, listingId: listing.id, bedId: booking.bedId, agentChannel: input.agentChannel },
    });

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: rowInclude });
    return { booking: toRow(row) };
  },
};

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/** Serialize one own-booking row — gross commission only, no company finance. */
function toRow(row: RowBooking): AgentErpBookingRow {
  return {
    bookingId: row.id,
    approval: approvalStatusOf(row.status, row.cancelledBy),
    bookingStatus: row.status,
    tenantName: row.tenant.fullName,
    listingId: row.listingId,
    listingAlias: row.listing.alias,
    agentChannel: row.agentChannel,
    monthlyRentPaise: row.monthlyRentPaise,
    tokenAmountPaise: row.tokenAmountPaise,
    depositPaise: row.depositPaise,
    moveInDate: row.moveInDate?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    commissionEarnedPaise: isCommissioned(row.status) ? commissionFor(row.monthlyRentPaise) : null,
  };
}

/** Translate the approval filter to a Prisma booking WHERE fragment (mirrors ERP-2). */
function approvalFilter(approval: AgentErpBookingsQuery["approval"]): Prisma.BookingWhereInput {
  switch (approval) {
    case undefined:
      return {};
    case "PENDING":
      return { status: { in: ["INITIATED", "PENDING_APPROVAL"] } };
    case "APPROVED":
      return { status: { in: ["TOKEN_PENDING", "CONFIRMED", "COMPLETED"] } };
    case "REJECTED":
      return { status: "CANCELLED", cancelledBy: { in: ["HOST", "SYSTEM"] } };
    case "CANCELLED":
      return { OR: [{ status: "CANCELLED", cancelledBy: "TENANT" }, { status: "CANCELLED", cancelledBy: null }, { status: "EXPIRED" }] };
  }
}

/**
 * The agent's rank in the monthly commission leaderboard, computed over ALL agents
 * server-side but returning ONLY the caller's position + the field size — never
 * another agent's commission. Commission uses the ONE engine definition, so the
 * ranking matches the admin leaderboard. Rank is null when the caller earned no
 * commission this month.
 */
async function monthlyRank(agentId: string, monthStart: Date, monthEnd: Date): Promise<{ rank: number | null; totalAgents: number }> {
  const confirmed = await prisma.booking.findMany({
    where: { status: { in: [...COMMISSIONED_STATUSES] }, confirmedAt: { gte: monthStart, lt: monthEnd }, bookedByAgentId: { not: null } },
    select: { bookedByAgentId: true, monthlyRentPaise: true },
  });
  const byAgent = new Map<string, number>();
  for (const b of confirmed) {
    const id = b.bookedByAgentId!;
    byAgent.set(id, (byAgent.get(id) ?? 0) + commissionFor(b.monthlyRentPaise));
  }
  const mine = byAgent.get(agentId);
  if (mine === undefined) return { rank: null, totalAgents: byAgent.size };
  let rank = 1;
  for (const [id, c] of byAgent) if (id !== agentId && c > mine) rank += 1;
  return { rank, totalAgents: byAgent.size };
}

/** Find a tenant by phone or create an unverified TENANT (the agent vouches). */
async function resolveTenantUser(name: string, phone: string): Promise<{ id: string; fullName: string }> {
  const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true, fullName: true } });
  if (existing) return existing;
  return prisma.user.create({ data: { phone, fullName: name, role: "TENANT", isPhoneVerified: false }, select: { id: true, fullName: true } });
}

/** The guest's KYC block as short-lived signed GET URLs (raw keys never leave). */
async function buildKycBlock(userId: string): Promise<AgentErpBookingDetail["kyc"]> {
  const rec = await prisma.kycRecord.findUnique({ where: { userId } });
  if (!rec) return null;
  const slots: Array<{ slot: BookingKycDocument["slot"]; key: string | null }> = [
    { slot: "AADHAAR_FRONT", key: rec.aadhaarFrontKey },
    { slot: "AADHAAR_BACK", key: rec.aadhaarBackKey },
    { slot: "SUPPORTING", key: rec.supportingDocKey },
  ];
  const documents: BookingKycDocument[] = [];
  for (const s of slots) {
    if (!s.key) continue;
    documents.push({ slot: s.slot, url: await objectStorage.presignDownload(s.key), expiresInSeconds: env.KYC_UPLOAD_URL_TTL_SECONDS });
  }
  return { status: rec.status, documents };
}
