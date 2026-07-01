import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Booking, PgListing, Room, User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { rentReminderNotifier, type RentReminderMessage } from "../../lib/rent-reminder.js";
import { rentService } from "./rent.service.js";

/**
 * Rent reminders (P1.5.2) against a live DB. The rent-billing sweep reminds each
 * DUE invoice once per window (5 days, then 1 day before due) and NEVER twice —
 * proven by re-running the sweep. A PAID invoice never reminds. We spy on the
 * messaging interface (env-gated, same pattern as SOS) to assert delivery.
 *
 * Isolation: sendDueReminders scans ALL due invoices, so we discriminate our own
 * invoices by a unique amount and read remindersSent back from the row — never a
 * bare global call count.
 */
const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
const NOW = new Date("2026-09-10T12:00:00Z");
const utc = (s: string) => new Date(s);

describe("rent reminders (integration)", () => {
  let host: User;
  let tenant: User;
  let listing: PgListing;
  let room: Room;
  let booking: Booking; // moveInDate null so the generator never adds invoices
  const listingIds: string[] = [];

  // Unique amount per invoice so we can pick its reminder call out of the sweep.
  let amountSeq = 0;
  let periodSeq = 0;
  function createInvoice(opts: { dueDate: Date; status?: "DUE" | "PAID" | "OVERDUE" }) {
    amountSeq += 1;
    periodSeq += 1;
    return prisma.rentInvoice.create({
      data: {
        bookingId: booking.id,
        periodMonth: new Date(Date.UTC(2031, periodSeq, 1)), // far-future, never collides
        amountPaise: 1_000_000 + amountSeq, // unique discriminator
        dueDate: opts.dueDate,
        status: opts.status ?? "DUE",
      },
    });
  }

  beforeAll(async () => {
    host = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Reminder Host", role: "HOST", isPhoneVerified: true } });
    tenant = await prisma.user.create({ data: { phone: uniquePhone(), fullName: "Reminder Tenant", role: "TENANT", isPhoneVerified: true } });
    listing = await prisma.pgListing.create({
      data: {
        hostId: host.id, alias: "Reminder PG", areaLabel: "Area", city: "City",
        actualName: "Reminder Real Name", fullAddress: "1 Reminder Road", pincode: "560001",
        latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
      },
    });
    listingIds.push(listing.id);
    room = await prisma.room.create({
      data: { listingId: listing.id, name: "Room", sharingType: 2, monthlyRentPaise: 1_200_000, depositPaise: 600_000 },
    });
    const bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 8)}`, status: "BOOKED" } });
    booking = await prisma.booking.create({
      data: {
        bedId: bed.id, tenantId: tenant.id, listingId: listing.id, status: "CONFIRMED",
        tokenAmountPaise: 600_000, monthlyRentPaise: 1_200_000, depositPaise: 600_000,
        moveInDate: null, confirmedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.rentInvoice.deleteMany({ where: { booking: { listingId: { in: listingIds } } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bed.deleteMany({ where: { room: { listingId: { in: listingIds } } } });
    await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.rentInvoice.deleteMany({ where: { booking: { listingId: { in: listingIds } } } });
  });

  /** Reminder messages the sweep delivered for the given invoice amount (our discriminator). */
  const messagesFor = (calls: ReadonlyArray<readonly [RentReminderMessage]>, amountPaise: number) =>
    calls.map((c) => c[0]).filter((m) => m.amountPaise === amountPaise);

  it("a DUE invoice exactly 5 days out triggers exactly one reminder — and re-running does NOT re-fire it", async () => {
    const invoice = await createInvoice({ dueDate: utc("2026-09-15T00:00:00Z") }); // NOW + 5 days
    const spy = vi.spyOn(rentReminderNotifier, "sendRentReminder").mockResolvedValue();
    try {
      await rentService.sendDueReminders(NOW);
      const first = messagesFor(spy.mock.calls, invoice.amountPaise);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        toPhone: tenant.phone,
        listingAlias: "Reminder PG", // masked alias only — never actualName
        daysBeforeDue: 5,
      });
      const afterFirst = await prisma.rentInvoice.findUnique({ where: { id: invoice.id } });
      expect(afterFirst?.remindersSent).toEqual(["DUE_IN_5_DAYS"]);

      // Idempotent: a second sweep at the same time must NOT remind again.
      await rentService.sendDueReminders(NOW);
      expect(messagesFor(spy.mock.calls, invoice.amountPaise)).toHaveLength(1);
      const afterSecond = await prisma.rentInvoice.findUnique({ where: { id: invoice.id } });
      expect(afterSecond?.remindersSent).toEqual(["DUE_IN_5_DAYS"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("the 1-day reminder fires once, separately from the 5-day window", async () => {
    const invoice = await createInvoice({ dueDate: utc("2026-09-11T00:00:00Z") }); // NOW + 1 day
    const spy = vi.spyOn(rentReminderNotifier, "sendRentReminder").mockResolvedValue();
    try {
      await rentService.sendDueReminders(NOW);
      const calls = messagesFor(spy.mock.calls, invoice.amountPaise);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ daysBeforeDue: 1 });
      const after = await prisma.rentInvoice.findUnique({ where: { id: invoice.id } });
      // Only the 1-day window fired — the 5-day window is not back-filled.
      expect(after?.remindersSent).toEqual(["DUE_IN_1_DAY"]);

      await rentService.sendDueReminders(NOW);
      expect(messagesFor(spy.mock.calls, invoice.amountPaise)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("a PAID invoice never reminds, even inside a reminder window", async () => {
    const invoice = await createInvoice({ dueDate: utc("2026-09-15T00:00:00Z"), status: "PAID" });
    const spy = vi.spyOn(rentReminderNotifier, "sendRentReminder").mockResolvedValue();
    try {
      await rentService.sendDueReminders(NOW);
      expect(messagesFor(spy.mock.calls, invoice.amountPaise)).toHaveLength(0);
      const after = await prisma.rentInvoice.findUnique({ where: { id: invoice.id } });
      expect(after?.remindersSent).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("both windows fire across the invoice's life — 5-day first, then 1-day", async () => {
    const invoice = await createInvoice({ dueDate: utc("2026-09-15T00:00:00Z") });
    const spy = vi.spyOn(rentReminderNotifier, "sendRentReminder").mockResolvedValue();
    try {
      await rentService.sendDueReminders(utc("2026-09-10T12:00:00Z")); // 5 days out
      await rentService.sendDueReminders(utc("2026-09-14T12:00:00Z")); // 1 day out
      const calls = messagesFor(spy.mock.calls, invoice.amountPaise);
      expect(calls.map((m) => m.daysBeforeDue)).toEqual([5, 1]);
      const after = await prisma.rentInvoice.findUnique({ where: { id: invoice.id } });
      expect(after?.remindersSent.sort()).toEqual(["DUE_IN_1_DAY", "DUE_IN_5_DAYS"]);
    } finally {
      spy.mockRestore();
    }
  });
});
