import { randomUUID } from "node:crypto";
import { type AdPricing, type AdSlot, type AdSlotType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { razorpay } from "../../lib/razorpay.js";
import { assertPaise } from "../../lib/money.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { listingService } from "../listing/listing.service.js";
import {
  canManageListing,
  listingInclude,
  toPublicListing,
  type PublicListing,
  type Viewer,
} from "../listing/serializer.js";
import { computeAdEndDate } from "./ad.logic.js";
import type { CreateAdInput, PutPricingInput } from "./ad.schema.js";

const FEATURED_CACHE_KEY = "featured:v1";
const FEATURED_TTL_SECONDS = 60;
const FEATURED_CACHE_MAX = 50; // cache a superset; slice per request

export async function invalidateFeaturedCache(): Promise<void> {
  await redis.del(FEATURED_CACHE_KEY);
}

export interface CreateAdResult {
  adSlotId: string;
  status: AdSlot["status"];
  startDate: string;
  endDate: string;
  pricePaise: number;
  razorpayOrder: { orderId: string; amount: number; currency: string; keyId: string };
}

export const adService = {
  /** ADMIN: upsert pricing for a slot type. Audited (before/after). */
  async putPricing(
    actor: { id: string },
    slotType: AdSlotType,
    input: PutPricingInput,
    ip?: string,
  ): Promise<AdPricing> {
    assertPaise(input.pricePaise);
    const before = await prisma.adPricing.findUnique({ where: { slotType } });
    const after = await prisma.adPricing.upsert({
      where: { slotType },
      create: { slotType, pricePaise: input.pricePaise, isActive: input.isActive },
      update: { pricePaise: input.pricePaise, isActive: input.isActive },
    });
    await writeAudit({
      actorId: actor.id,
      action: "ad.pricing.updated",
      targetId: after.id,
      ip,
      metadata: {
        slotType,
        before: before ? { pricePaise: before.pricePaise, isActive: before.isActive } : null,
        after: { pricePaise: after.pricePaise, isActive: after.isActive },
      },
    });
    return after;
  },

  /** HOST: create an ad slot for an owned listing + a Razorpay order. */
  async createAd(host: Viewer, input: CreateAdInput): Promise<CreateAdResult> {
    const ownership = await listingService.getOwnership(input.listingId);
    if (!ownership) {
      throw new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });
    }
    if (!canManageListing(ownership, host)) {
      throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "You do not own this listing" });
    }
    const pricing = await prisma.adPricing.findUnique({ where: { slotType: input.slotType } });
    if (!pricing || !pricing.isActive) {
      throw new AppError({ statusCode: 400, code: "PRICING_UNAVAILABLE", message: "No active pricing for this slot type" });
    }
    assertPaise(pricing.pricePaise);

    const endDate = computeAdEndDate(input.startDate, input.slotType);
    const order = await razorpay.createOrder(pricing.pricePaise, `ad_${randomUUID()}`);
    const ad = await prisma.adSlot.create({
      data: {
        listingId: input.listingId,
        createdById: host.id,
        slotType: input.slotType,
        startDate: input.startDate,
        endDate,
        pricePaise: pricing.pricePaise,
        status: "PENDING_PAYMENT",
        razorpayOrderId: order.id,
      },
    });
    return {
      adSlotId: ad.id,
      status: ad.status,
      startDate: ad.startDate.toISOString(),
      endDate: ad.endDate.toISOString(),
      pricePaise: ad.pricePaise,
      razorpayOrder: { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID },
    };
  },

  /** ADMIN: paginated queue of ads awaiting approval. */
  async listPending(query: { cursor?: string; limit: number }): Promise<Page<unknown>> {
    const rows = await prisma.adSlot.findMany({
      where: { status: "PENDING_APPROVAL" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { listing: { select: { id: true, alias: true, city: true, status: true } } },
    });
    const page = toPage(rows, query.limit);
    return {
      items: page.items.map((ad) => ({
        id: ad.id,
        listing: ad.listing,
        slotType: ad.slotType,
        startDate: ad.startDate.toISOString(),
        endDate: ad.endDate.toISOString(),
        pricePaise: ad.pricePaise,
        status: ad.status,
        paidAt: ad.paidAt?.toISOString() ?? null,
        createdAt: ad.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  },

  /** ADMIN: approve a paid ad. Audited; invalidates the featured cache. */
  async approve(actor: { id: string }, adId: string, ip?: string): Promise<AdSlot> {
    const ad = await prisma.adSlot.findUnique({ where: { id: adId } });
    if (!ad) throw new AppError({ statusCode: 404, code: "AD_NOT_FOUND", message: "Ad not found" });
    if (ad.status !== "PENDING_APPROVAL") {
      throw new AppError({ statusCode: 409, code: "INVALID_STATE", message: "Only paid, pending ads can be approved" });
    }
    const updated = await prisma.adSlot.update({
      where: { id: adId },
      data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date() },
    });
    await writeAudit({
      actorId: actor.id,
      action: "ad.approved",
      targetId: adId,
      ip,
      metadata: { before: { status: ad.status }, after: { status: "APPROVED" } },
    });
    await invalidateFeaturedCache();
    return updated;
  },

  /** ADMIN: reject a paid ad. Audited. */
  async reject(actor: { id: string }, adId: string, reason: string, ip?: string): Promise<AdSlot> {
    const ad = await prisma.adSlot.findUnique({ where: { id: adId } });
    if (!ad) throw new AppError({ statusCode: 404, code: "AD_NOT_FOUND", message: "Ad not found" });
    if (ad.status !== "PENDING_APPROVAL") {
      throw new AppError({ statusCode: 409, code: "INVALID_STATE", message: "Only paid, pending ads can be rejected" });
    }
    const updated = await prisma.adSlot.update({
      where: { id: adId },
      data: { status: "REJECTED", rejectedReason: reason },
    });
    await writeAudit({
      actorId: actor.id,
      action: "ad.rejected",
      targetId: adId,
      ip,
      metadata: { before: { status: ad.status }, after: { status: "REJECTED" }, reason },
    });
    return updated;
  },

  /** PUBLIC: featured listings (APPROVED + in-window + PUBLISHED), cached 60s. */
  async featured(limit: number): Promise<PublicListing[]> {
    const cached = await redis.get(FEATURED_CACHE_KEY);
    if (cached) {
      return (JSON.parse(cached) as PublicListing[]).slice(0, limit);
    }
    const now = new Date();
    const ads = await prisma.adSlot.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: now },
        endDate: { gte: now },
        listing: { status: "PUBLISHED" },
      },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      take: FEATURED_CACHE_MAX,
      include: { listing: { include: listingInclude } },
    });

    const seen = new Set<string>();
    const listings: PublicListing[] = [];
    for (const ad of ads) {
      if (seen.has(ad.listingId)) continue;
      seen.add(ad.listingId);
      listings.push(toPublicListing(ad.listing));
    }
    await redis.set(FEATURED_CACHE_KEY, JSON.stringify(listings), "EX", FEATURED_TTL_SECONDS);
    return listings.slice(0, limit);
  },

  /**
   * Sweep ad slots whose window has ended: PENDING_PAYMENT / PENDING_APPROVAL /
   * APPROVED past endDate -> EXPIRED. REJECTED and CANCELLED (terminal records)
   * and already-EXPIRED rows are left untouched, so the sweep is idempotent.
   * One atomic UPDATE. Run by the BullMQ job. Returns the number of slots
   * expired. Mirrors bookingService.expireStaleHolds.
   */
  async expireEndedAdSlots(): Promise<number> {
    return prisma.$executeRaw`
      UPDATE ad_slots
      SET status = 'EXPIRED', "updatedAt" = now()
      WHERE "endDate" < now()
        AND status IN ('PENDING_PAYMENT', 'PENDING_APPROVAL', 'APPROVED')
    `;
  },
};
