import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { invalidateFeaturedCache } from "../ad/ad.service.js";
import type {
  bookingSearchSchema,
  cashQuerySchema,
  kycQuerySchema,
  listingReviewQuerySchema,
  paymentSearchSchema,
} from "./admin.schema.js";
import type { z } from "zod";

type Actor = { id: string };
type Paged = { cursor?: string; limit: number };

const kycNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "KYC_NOT_FOUND", message: "KYC record not found" });
const listingNotFound = (): AppError =>
  new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });

export const adminService = {
  // ---- KYC review --------------------------------------------------------
  async listKyc(query: z.infer<typeof kycQuerySchema>): Promise<Page<unknown>> {
    const rows = await prisma.kycRecord.findMany({
      where: { status: query.status },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { user: { select: { id: true, phone: true, fullName: true, role: true } } },
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((k) => ({
        id: k.id,
        status: k.status,
        docType: k.docType,
        user: k.user,
        createdAt: k.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  },

  async approveKyc(actor: Actor, kycId: string, ip?: string): Promise<{ id: string; status: string }> {
    const kyc = await prisma.kycRecord.findUnique({ where: { id: kycId } });
    if (!kyc) throw kycNotFound();
    const updated = await prisma.kycRecord.update({
      where: { id: kycId },
      data: { status: "VERIFIED", verifiedAt: new Date(), rejectedAt: null, rejectReason: null },
    });
    await writeAudit({
      actorId: actor.id,
      action: "kyc.approved",
      targetId: kycId,
      ip,
      metadata: { userId: kyc.userId, before: { status: kyc.status }, after: { status: "VERIFIED" } },
    });
    return { id: updated.id, status: updated.status };
  },

  async rejectKyc(actor: Actor, kycId: string, reason: string, ip?: string): Promise<{ id: string; status: string }> {
    const kyc = await prisma.kycRecord.findUnique({ where: { id: kycId } });
    if (!kyc) throw kycNotFound();
    const updated = await prisma.kycRecord.update({
      where: { id: kycId },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectReason: reason, verifiedAt: null },
    });
    await writeAudit({
      actorId: actor.id,
      action: "kyc.rejected",
      targetId: kycId,
      ip,
      metadata: { userId: kyc.userId, before: { status: kyc.status }, after: { status: "REJECTED" }, reason },
    });
    return { id: updated.id, status: updated.status };
  },

  // ---- Listing review / publish -----------------------------------------
  async listListings(query: z.infer<typeof listingReviewQuerySchema>): Promise<Page<unknown>> {
    const rows = await prisma.pgListing.findMany({
      where: { status: query.status },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: { id: true, alias: true, actualName: true, city: true, status: true, hostId: true, createdAt: true },
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  },

  async publishListing(actor: Actor, id: string, ip?: string): Promise<{ id: string; status: string }> {
    const listing = await prisma.pgListing.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!listing) throw listingNotFound();
    const updated = await prisma.pgListing.update({ where: { id }, data: { status: "PUBLISHED" } });
    await writeAudit({
      actorId: actor.id,
      action: "listing.published",
      targetId: id,
      ip,
      metadata: { before: { status: listing.status }, after: { status: "PUBLISHED" } },
    });
    await invalidateFeaturedCache();
    return { id: updated.id, status: updated.status };
  },

  async suspendListing(actor: Actor, id: string, ip?: string): Promise<{ id: string; status: string }> {
    const listing = await prisma.pgListing.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!listing) throw listingNotFound();
    const updated = await prisma.pgListing.update({ where: { id }, data: { status: "SUSPENDED" } });
    await writeAudit({
      actorId: actor.id,
      action: "listing.suspended",
      targetId: id,
      ip,
      metadata: { before: { status: listing.status }, after: { status: "SUSPENDED" } },
    });
    await invalidateFeaturedCache();
    return { id: updated.id, status: updated.status };
  },

  // ---- Cash reconciliation ----------------------------------------------
  /** Per-agent cash-in-hand = sum of COLLECTED (not yet RECONCILED). */
  async cashInHand(query: Paged): Promise<Page<unknown>> {
    const grouped = await prisma.cashCollection.groupBy({
      by: ["agentId"],
      where: { status: "COLLECTED", ...(query.cursor ? { agentId: { gt: query.cursor } } : {}) },
      _sum: { amountPaise: true },
      orderBy: { agentId: "asc" },
      take: query.limit + 1,
    });
    const page = toPage(
      grouped.map((g) => ({ id: g.agentId, agentId: g.agentId, cashInHandPaise: g._sum.amountPaise ?? 0 })),
      query.limit,
    );
    const agents = await prisma.user.findMany({
      where: { id: { in: page.items.map((i) => i.agentId) } },
      select: { id: true, fullName: true, phone: true },
    });
    const byId = new Map(agents.map((a) => [a.id, a]));
    return {
      items: page.items.map((i) => ({
        agentId: i.agentId,
        agentName: byId.get(i.agentId)?.fullName ?? null,
        agentPhone: byId.get(i.agentId)?.phone ?? null,
        cashInHandPaise: i.cashInHandPaise,
      })),
      nextCursor: page.nextCursor,
    };
  },

  /** Queue of collected-but-not-reconciled cash. Reconcile via PATCH .../reconcile. */
  async reconciliationQueue(query: z.infer<typeof cashQuerySchema>): Promise<Page<unknown>> {
    const rows = await prisma.cashCollection.findMany({
      where: { status: "COLLECTED" },
      orderBy: [{ collectedAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        agent: { select: { id: true, fullName: true, phone: true } },
        booking: { select: { id: true, listingId: true, tenantId: true } },
      },
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((cc) => ({
        id: cc.id,
        amountPaise: cc.amountPaise,
        status: cc.status,
        collectedAt: cc.collectedAt?.toISOString() ?? null,
        agent: cc.agent,
        booking: cc.booking,
      })),
      nextCursor: page.nextCursor,
    };
  },

  // ---- Search ------------------------------------------------------------
  async searchBookings(query: z.infer<typeof bookingSearchSchema>): Promise<Page<unknown>> {
    const where: Prisma.BookingWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.listingId) where.listingId = query.listingId;
    const rows = await prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((b) => ({
        id: b.id,
        status: b.status,
        tenantId: b.tenantId,
        listingId: b.listingId,
        bedId: b.bedId,
        tokenAmountPaise: b.tokenAmountPaise,
        confirmedAt: b.confirmedAt?.toISOString() ?? null,
        createdAt: b.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  },

  async searchPayments(query: z.infer<typeof paymentSearchSchema>): Promise<Page<unknown>> {
    const where: Prisma.PaymentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.bookingId) where.bookingId = query.bookingId;
    const rows = await prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((p) => ({
        id: p.id,
        bookingId: p.bookingId,
        amountPaise: p.amountPaise,
        status: p.status,
        method: p.method,
        razorpayOrderId: p.razorpayOrderId,
        createdAt: p.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  },
};
