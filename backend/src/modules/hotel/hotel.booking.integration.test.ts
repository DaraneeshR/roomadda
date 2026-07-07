import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HotelRoomCategory, PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { hotelService } from "./hotel.service.js";
import { hotelPaymentService } from "./hotel.payment.service.js";
import { webhookService } from "../booking/webhook.service.js";
import { refundService } from "../refund/refund.service.js";

/**
 * H1 — B2C hotel booking proofs (live DB). Everything money/inventory is
 * server-owned and the reservation is CONFIRMED / refunded ONLY by the verified
 * webhook — the app callback never confirms.
 */

const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** A signed payment.captured webhook (raw body + valid signature), like the PG test. */
function capturedEvent(orderId: string, amountPaise: number) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: orderId, amount: amountPaise } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature };
}

/** A signed refund.processed / refund.failed webhook. */
function refundEvent(refundId: string, status: "processed" | "failed", amountPaise: number) {
  const body = JSON.stringify({
    event: `refund.${status}`,
    payload: { refund: { entity: { id: refundId, payment_id: `pay_${randomUUID().slice(0, 8)}`, amount: amountPaise, status } } },
  });
  const raw = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return { raw, signature };
}

const PER_NIGHT = 300_000; // paise

describe("hotel B2C booking (integration)", () => {
  let host: User;
  let guest: User;
  const city = `HotelBk-${randomUUID().slice(0, 8)}`;
  const listingIds: string[] = [];

  async function makeHotel(alias: string): Promise<PgListing> {
    const l = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias, areaLabel: "Area", city,
        actualName: `${alias} Real`, fullAddress: "1 Test Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
        propertyType: "HOTEL", visibility: "USER_ONLY",
      },
    });
    listingIds.push(l.id);
    return l;
  }

  /** Create a category, provision its units, return it. */
  async function makeCategory(listingId: string, totalRooms: number, corporateReservedRooms: number): Promise<HotelRoomCategory> {
    const c = await prisma.hotelRoomCategory.create({
      data: { listingId, tier: `Tier-${randomUUID().slice(0, 6)}`, perNightPaise: PER_NIGHT, totalRooms, corporateReservedRooms },
    });
    await hotelService.provisionUnits(c.id);
    return c;
  }

  const search = (checkIn: string, checkOut: string) =>
    hotelService.searchAvailability({ city, checkIn: day(checkIn), checkOut: day(checkOut), guests: 1, limit: 20 });

  const availableFor = async (listingId: string, categoryId: string, checkIn: string, checkOut: string): Promise<number> => {
    const res = await search(checkIn, checkOut);
    const listing = res.items.find((i) => i.listing.id === listingId);
    return listing?.categories.find((c) => c.categoryId === categoryId)?.availableRooms ?? 0;
  };

  beforeAll(async () => {
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Hotel Host", role: "HOST", isPhoneVerified: true } });
    guest = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Guest", role: "TENANT", isPhoneVerified: true } });
  });

  afterAll(async () => {
    // pg_listings cascade categories -> rooms -> reservations -> refund_transactions.
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_htest_" } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, guest.id] } } });
    await prisma.$disconnect();
  });

  // ---- Availability: carve-out + excludes reserved ------------------------
  it("availability respects the corporate carve-out and excludes reserved units", async () => {
    const listing = await makeHotel("Carve Hotel");
    // totalRooms 3, corporate 1 -> 2 B2C units bookable.
    const category = await makeCategory(listing.id, 3, 1);

    // Open range: exactly the B2C count (NOT totalRooms) — corporate is carved out.
    expect(await availableFor(listing.id, category.id, "2026-09-01", "2026-09-04")).toBe(2);

    // Hold one B2C room for [Sep 1, Sep 4) -> availability in that range drops to 1.
    await hotelService.createReservationHold(guest.id, {
      categoryId: category.id, checkIn: day("2026-09-01"), checkOut: day("2026-09-04"), guests: 1,
    });
    expect(await availableFor(listing.id, category.id, "2026-09-01", "2026-09-04")).toBe(1);

    // A non-overlapping range is unaffected — still both B2C rooms free.
    expect(await availableFor(listing.id, category.id, "2026-09-04", "2026-09-06")).toBe(2);
  });

  // ---- Overbooking guard: overlapping double-book impossible --------------
  it("two concurrent holds on a 1-room category -> exactly one succeeds (guard)", async () => {
    const listing = await makeHotel("Race Hotel");
    const category = await makeCategory(listing.id, 1, 0); // a single B2C unit

    const input = { categoryId: category.id, checkIn: day("2026-10-01"), checkOut: day("2026-10-05"), guests: 1 };
    const results = await Promise.allSettled([
      hotelService.createReservationHold(guest.id, input),
      hotelService.createReservationHold(guest.id, input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const live = await prisma.hotelReservation.count({
      where: { categoryId: category.id, status: { in: ["HELD", "CONFIRMED"] } },
    });
    expect(live).toBe(1);
  });

  it("the EXCLUDE constraint rejects a forced overlapping double-book at the DB", async () => {
    const listing = await makeHotel("Guard Hotel");
    const category = await makeCategory(listing.id, 1, 0);
    const unit = await prisma.hotelRoom.findFirstOrThrow({ where: { categoryId: category.id, channel: "B2C" } });
    const base = {
      hotelRoomId: unit.id, categoryId: category.id, listingId: listing.id, guestId: guest.id,
      channel: "B2C" as const, perNightPaise: PER_NIGHT, nights: 4, roomTotalPaise: 4 * PER_NIGHT, tokenAmountPaise: 4 * PER_NIGHT,
    };
    await prisma.hotelReservation.create({ data: { ...base, status: "HELD", checkIn: day("2026-11-01"), checkOut: day("2026-11-05") } });
    // Bypass the service entirely; the guard must reject the overlapping insert.
    await expect(
      prisma.hotelReservation.create({ data: { ...base, status: "HELD", checkIn: day("2026-11-03"), checkOut: day("2026-11-07") } }),
    ).rejects.toThrow();
  });

  // ---- Price is server-owned (perNightPaise x nights) ---------------------
  it("snapshots price = perNightPaise x nights server-side (no client math)", async () => {
    const listing = await makeHotel("Price Hotel");
    const category = await makeCategory(listing.id, 2, 0);

    // 5-night stay. The client sends ONLY dates; the server computes the money.
    const reservation = await hotelService.createReservationHold(guest.id, {
      categoryId: category.id, checkIn: day("2026-12-01"), checkOut: day("2026-12-06"), guests: 1,
    });
    expect(reservation.nights).toBe(5);
    expect(reservation.perNightPaise).toBe(PER_NIGHT);
    expect(reservation.roomTotalPaise).toBe(PER_NIGHT * 5);
    expect(reservation.tokenAmountPaise).toBe(PER_NIGHT * 5);
    expect(reservation.status).toBe("HELD");
  });

  // ---- CONFIRMED only via the verified webhook ----------------------------
  it("a hold + payment order stays HELD; ONLY the verified webhook confirms + mints the QR", async () => {
    const listing = await makeHotel("Confirm Hotel");
    const category = await makeCategory(listing.id, 1, 0);
    const held = await hotelService.createReservationHold(guest.id, {
      categoryId: category.id, checkIn: day("2027-01-10"), checkOut: day("2027-01-13"), guests: 1,
    });
    const total = PER_NIGHT * 3;

    // Initiate payment -> Razorpay order. This does NOT confirm (the "app success
    // callback" is submitted, never confirmed).
    const pay = await hotelPaymentService.createReservationOrder(held.id, guest.id);
    expect(pay.amountPaise).toBe(total);
    const orderId = pay.razorpayOrder.orderId;

    let current = await prisma.hotelReservation.findUniqueOrThrow({ where: { id: held.id } });
    expect(current.status).toBe("HELD"); // no client-side confirmation
    expect(current.qrCodeToken).toBeNull();

    // A PARTIAL capture must NOT confirm the stay.
    const partial = capturedEvent(orderId, total - 1);
    await webhookService.processRazorpay(partial.raw, partial.signature, `evt_htest_partial_${randomUUID()}`);
    current = await prisma.hotelReservation.findUniqueOrThrow({ where: { id: held.id } });
    expect(current.status).toBe("HELD");

    // The FULL captured webhook confirms + mints the check-in QR + records the payment id.
    const full = capturedEvent(orderId, total);
    const eventId = `evt_htest_confirm_${randomUUID()}`;
    const first = await webhookService.processRazorpay(full.raw, full.signature, eventId);
    expect(first.status).toBe("processed");

    current = await prisma.hotelReservation.findUniqueOrThrow({ where: { id: held.id } });
    expect(current.status).toBe("CONFIRMED");
    expect(current.confirmedAt).not.toBeNull();
    expect(current.qrCodeToken).toMatch(/^hqr_/);
    expect(current.razorpayPaymentId).not.toBeNull();

    // Replaying the same event is idempotent (no double-confirm).
    const second = await webhookService.processRazorpay(full.raw, full.signature, eventId);
    expect(second.status).toBe("duplicate");
    const qrAfter = (await prisma.hotelReservation.findUniqueOrThrow({ where: { id: held.id } })).qrCodeToken;
    expect(qrAfter).toBe(current.qrCodeToken);
  });

  // ---- Refund settles ONLY via the verified webhook -----------------------
  it("cancelling a CONFIRMED reservation refunds ONLY via the verified webhook", async () => {
    const listing = await makeHotel("Refund Hotel");
    const category = await makeCategory(listing.id, 1, 0);
    // Far-future stay so the tenant policy gives a FULL refund.
    const held = await hotelService.createReservationHold(guest.id, {
      categoryId: category.id, checkIn: day("2027-06-01"), checkOut: day("2027-06-04"), guests: 1,
    });
    const total = PER_NIGHT * 3;
    const pay = await hotelPaymentService.createReservationOrder(held.id, guest.id);
    const full = capturedEvent(pay.razorpayOrder.orderId, total);
    await webhookService.processRazorpay(full.raw, full.signature, `evt_htest_rfconfirm_${randomUUID()}`);

    // Cancel -> refund INITIATED (never settled by the cancel call itself).
    const result = await refundService.cancelHotelReservationByGuest(guest.id, held.id, "changed plans");
    expect(result.status).toBe("CANCELLED");
    expect(result.refundPaise).toBe(total); // full-refund window
    expect(result.refundStatus).toBe("PENDING");

    const reservation = await prisma.hotelReservation.findUniqueOrThrow({ where: { id: held.id } });
    expect(reservation.status).toBe("CANCELLED");

    const refundTx = await prisma.refundTransaction.findFirstOrThrow({ where: { hotelReservationId: held.id } });
    expect(refundTx.status).toBe("INITIATED"); // NOT settled yet
    expect(refundTx.razorpayRefundId).not.toBeNull();

    // The cancelled room is freed for the guard (available again for that range).
    expect(await availableFor(listing.id, category.id, "2027-06-01", "2027-06-04")).toBe(1);

    // ONLY the verified refund webhook settles it.
    const rf = refundEvent(refundTx.razorpayRefundId!, "processed", total);
    const processed = await webhookService.processRazorpay(rf.raw, rf.signature, `evt_htest_refund_${randomUUID()}`);
    expect(processed.status).toBe("processed");

    const settled = await prisma.refundTransaction.findUniqueOrThrow({ where: { id: refundTx.id } });
    expect(settled.status).toBe("PROCESSED");
    expect(settled.processedAt).not.toBeNull();
  });
});
