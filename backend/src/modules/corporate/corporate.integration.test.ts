import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PgListing, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { listingService } from "../listing/listing.service.js";
import { corporateInventoryService } from "./corporate.inventory.service.js";
import { corporateEmployeeService } from "./corporate.employee.js";

/**
 * Corporate (B2B) add-on — C0 schema-gate proofs (no flow yet):
 *
 *  1. VISIBILITY, BOTH DIRECTIONS (extends the H0 filter): a CORPORATE_ONLY listing
 *     is reachable in a CORPORATE-context read AND is NEVER in a B2C read; a
 *     USER_ONLY listing is the mirror; BOTH appears in both.
 *
 *  2. EMPLOYEE PRIVACY, BOTH DIRECTIONS (structural): an employee-scoped read shows
 *     the employee's OWN stay + QR (safe fields present) and exposes NO negotiated
 *     rate / company finance / OTHER employee's stay (forbidden data absent).
 */

const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("corporate add-on schema gate (integration)", () => {
  let host: User;
  const city = `CorpTest-${randomUUID().slice(0, 8)}`;
  const listingIds: string[] = [];
  const companyIds: string[] = [];
  const userIds: string[] = [];

  async function makeListing(
    propertyType: PgListing["propertyType"],
    visibility: PgListing["visibility"],
    alias: string,
  ): Promise<PgListing> {
    const l = await prisma.pgListing.create({
      data: {
        hostId: host.id,
        alias,
        areaLabel: "Area 51",
        city,
        actualName: `${alias} Real Name`,
        fullAddress: "1 Corporate Road",
        pincode: "560001",
        latitude: 12.9,
        longitude: 77.6,
        status: "PUBLISHED",
        propertyType,
        visibility,
      },
    });
    listingIds.push(l.id);
    return l;
  }

  beforeAll(async () => {
    host = await prisma.user.create({
      data: { phone: uniquePhone(), fullName: "Corp Host", role: "HOST", isPhoneVerified: true },
    });
    userIds.push(host.id);
  });

  afterAll(async () => {
    // Allocations reference employees with onDelete: Restrict, so free them before
    // the company cascade removes the employee directory.
    await prisma.employeeAllocation.deleteMany({
      where: { corporateBooking: { companyId: { in: companyIds } } },
    });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  // ---- 1. Visibility, both directions -------------------------------------
  describe("visibility (extends the H0 filter — both directions)", () => {
    it("CORPORATE_ONLY is reachable in corporate context but ABSENT from B2C", async () => {
      const userOnly = await makeListing("PG", "USER_ONLY", "B2C Only");
      const both = await makeListing("HOTEL", "BOTH", "Dual Channel");
      const corpOnly = await makeListing("HOTEL", "CORPORATE_ONLY", "Corp Only");

      const b2c = await listingService.listPublished({ city, limit: 50 });
      const b2cIds = new Set(b2c.items.map((l) => l.id));
      const corp = await corporateInventoryService.listCorporateInventory({ city, limit: 50 });
      const corpIds = new Set(corp.items.map((l) => l.id));

      // B2C sees USER_ONLY + BOTH, never CORPORATE_ONLY.
      expect(b2cIds.has(userOnly.id)).toBe(true);
      expect(b2cIds.has(both.id)).toBe(true);
      expect(b2cIds.has(corpOnly.id)).toBe(false);

      // CORPORATE sees CORPORATE_ONLY + BOTH, never USER_ONLY.
      expect(corpIds.has(corpOnly.id)).toBe(true);
      expect(corpIds.has(both.id)).toBe(true);
      expect(corpIds.has(userOnly.id)).toBe(false);
    });

    it("the corporate read returns the MASKED shape (no actualName leak)", async () => {
      const corp = await corporateInventoryService.listCorporateInventory({ city, limit: 50 });
      for (const item of corp.items) {
        expect(item).not.toHaveProperty("actualName");
        expect(item).not.toHaveProperty("fullAddress");
      }
    });
  });

  // ---- 2. Employee privacy, both directions -------------------------------
  describe("employee privacy (structural — both directions)", () => {
    // The safe fields an employee stay view is ALLOWED to carry.
    const ALLOWED_KEYS = new Set([
      "allocationId",
      "status",
      "companyName",
      "areaLabel",
      "city",
      "tier",
      "checkIn",
      "checkOut",
      "reservationStatus",
      "propertyName",
      "qrCodeToken",
    ]);
    const NEGOTIATED_TOTAL = 987_654_00; // the company's negotiated money — must never leak

    let empAUser: User;
    let empBUser: User;

    beforeAll(async () => {
      const listing = await makeListing("HOTEL", "CORPORATE_ONLY", "Corp Stay Hotel");
      const category = await prisma.hotelRoomCategory.create({
        data: { listingId: listing.id, tier: "Executive Suite", perNightPaise: 500_000, totalRooms: 2, corporateReservedRooms: 2 },
      });
      const roomA = await prisma.hotelRoom.create({ data: { categoryId: category.id, label: "C-1", channel: "CORPORATE" } });
      const roomB = await prisma.hotelRoom.create({ data: { categoryId: category.id, label: "C-2", channel: "CORPORATE" } });

      const company = await prisma.company.create({
        data: { name: "Acme Corp", billingMode: "CREDIT", creditDays: 30 },
      });
      companyIds.push(company.id);

      // Two employees, each linked to their own consumer login.
      empAUser = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Alice Employee", role: "TENANT", isPhoneVerified: true } });
      empBUser = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Bob Employee", role: "TENANT", isPhoneVerified: true } });
      userIds.push(empAUser.id, empBUser.id);
      const empA = await prisma.employee.create({
        data: { companyId: company.id, fullName: "Alice Employee", phone: empAUser.phone!, userId: empAUser.id },
      });
      const empB = await prisma.employee.create({
        data: { companyId: company.id, fullName: "Bob Employee", phone: empBUser.phone!, userId: empBUser.id },
      });

      // A quotation carrying the NEGOTIATED rate + a corporate booking snapshotting it.
      const quotation = await prisma.quotation.create({
        data: { companyId: company.id, createdById: host.id, status: "ACCEPTED", currentRevision: 1 },
      });
      await prisma.quotationRevision.create({
        data: {
          quotationId: quotation.id,
          revision: 1,
          createdById: host.id,
          subtotalPaise: NEGOTIATED_TOTAL,
          totalPaise: NEGOTIATED_TOTAL,
        },
      });
      const booking = await prisma.corporateBooking.create({
        data: { companyId: company.id, quotationId: quotation.id, createdById: host.id, status: "CONFIRMED", totalPaise: NEGOTIATED_TOTAL },
      });
      await prisma.corporateInvoice.create({
        data: { companyId: company.id, corporateBookingId: booking.id, billingMode: "CREDIT", status: "DUE", totalPaise: NEGOTIATED_TOTAL },
      });

      // Employee A: a CONFIRMED stay with a QR. Employee B: a HELD stay (no QR yet).
      const resA = await prisma.hotelReservation.create({
        data: {
          hotelRoomId: roomA.id, categoryId: category.id, listingId: listing.id, corporateBookingId: booking.id,
          guestId: empAUser.id, channel: "CORPORATE", status: "CONFIRMED",
          checkIn: day("2026-09-01"), checkOut: day("2026-09-04"),
          perNightPaise: 500_000, nights: 3, roomTotalPaise: 1_500_000,
          qrCodeToken: `qr_${randomUUID()}`, confirmedAt: new Date(),
        },
      });
      const resB = await prisma.hotelReservation.create({
        data: {
          hotelRoomId: roomB.id, categoryId: category.id, listingId: listing.id, corporateBookingId: booking.id,
          guestId: empBUser.id, channel: "CORPORATE", status: "HELD",
          checkIn: day("2026-09-01"), checkOut: day("2026-09-04"),
          perNightPaise: 500_000, nights: 3, roomTotalPaise: 1_500_000,
        },
      });
      await prisma.employeeAllocation.create({ data: { corporateBookingId: booking.id, employeeId: empA.id, hotelReservationId: resA.id } });
      await prisma.employeeAllocation.create({ data: { corporateBookingId: booking.id, employeeId: empB.id, hotelReservationId: resB.id } });
    });

    it("shows the employee ONLY their own stay + QR, with no money field", async () => {
      const stays = await corporateEmployeeService.listMyStays(empAUser.id);
      expect(stays).toHaveLength(1);
      const [stay] = stays;

      // Safe fields present + correct.
      expect(stay!.tier).toBe("Executive Suite");
      expect(stay!.city).toBe(city);
      expect(stay!.reservationStatus).toBe("CONFIRMED");
      expect(stay!.propertyName).toBe("Corp Stay Hotel Real Name"); // CONFIRMED → entitled
      expect(stay!.qrCodeToken).toMatch(/^qr_/);
      expect(stay!.companyName).toBe("Acme Corp");

      // FORBIDDEN data absent: no key outside the safe set, no negotiated amount
      // anywhere in the serialized payload.
      for (const key of Object.keys(stay!)) expect(ALLOWED_KEYS.has(key)).toBe(true);
      const serialized = JSON.stringify(stay);
      expect(serialized).not.toContain(String(NEGOTIATED_TOTAL));
      expect(serialized.toLowerCase()).not.toContain("paise");
    });

    it("never exposes ANOTHER employee's stay (own-scope only)", async () => {
      const aStays = await corporateEmployeeService.listMyStays(empAUser.id);
      const bStays = await corporateEmployeeService.listMyStays(empBUser.id);

      // A's QR must not appear in B's stays and vice-versa.
      const aQr = aStays[0]!.qrCodeToken;
      expect(bStays.some((s) => s.qrCodeToken === aQr)).toBe(false);

      // B's stay is HELD → no property name, no QR (entitlement gate).
      expect(bStays).toHaveLength(1);
      expect(bStays[0]!.reservationStatus).toBe("HELD");
      expect(bStays[0]!.propertyName).toBeNull();
      expect(bStays[0]!.qrCodeToken).toBeNull();
    });

    it("a user with no employee record sees nothing", async () => {
      const stays = await corporateEmployeeService.listMyStays(host.id);
      expect(stays).toEqual([]);
    });
  });
});
