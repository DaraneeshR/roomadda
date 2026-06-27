import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { KycStatus, PgListing } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { adminService } from "./admin.service.js";
import {
  assertListingPublishable,
  listingService,
  MIN_PUBLISH_PHOTOS,
  type PublishGateFailure,
} from "../listing/listing.service.js";

/**
 * The PRD §9.2 go-live gate, proven end-to-end against a live DB: NO code path
 * may set a listing PUBLISHED unless it has >= MIN_PUBLISH_PHOTOS photos, the
 * host's KYC is VERIFIED, and at least one room has a rent > 0 paise. Both
 * publish paths are exercised — adminService.publishListing and the status-edit
 * path in listingService.updateListing — plus the success audit trail.
 */

const uniquePhone = () => "+9190" + Math.floor(10_000_000 + Math.random() * 89_999_999).toString();

const hostIds: string[] = [];
const listingIds: string[] = [];

/**
 * Create a host + listing in a controlled state. `pricedRoom: false` still adds
 * a room, but at 0 paise — so we also prove rent must be strictly > 0.
 */
async function makeListing(opts: {
  photos: number;
  kyc: KycStatus | null;
  pricedRoom: boolean;
}): Promise<PgListing> {
  const host = await prisma.user.create({
    data: { phone: uniquePhone(), fullName: "Gate Host", role: "HOST", isPhoneVerified: true },
  });
  hostIds.push(host.id);

  if (opts.kyc) {
    await prisma.kycRecord.create({
      data: { userId: host.id, status: opts.kyc, docType: "AADHAAR", docRef: "ref_" + randomUUID() },
    });
  }

  const listing = await prisma.pgListing.create({
    data: {
      hostId: host.id,
      alias: "Gate PG",
      areaLabel: "Area",
      city: "City",
      actualName: "Gate Real Name",
      fullAddress: "1 Gate Road",
      pincode: "560001",
      latitude: 12.9,
      longitude: 77.6,
      status: "PENDING_REVIEW",
    },
  });
  listingIds.push(listing.id);

  if (opts.photos > 0) {
    await prisma.listingPhoto.createMany({
      data: Array.from({ length: opts.photos }, (_, i) => ({
        listingId: listing.id,
        url: `https://cdn.example/${listing.id}/${i}.jpg`,
        isPrimary: i === 0,
        sortOrder: i,
      })),
    });
  }

  await prisma.room.create({
    data: {
      listingId: listing.id,
      name: "R1",
      sharingType: 2,
      monthlyRentPaise: opts.pricedRoom ? 1_000_000 : 0,
      depositPaise: 0,
    },
  });

  return listing;
}

/** Assert a publish attempt rejected with the typed 422 and exact failed reasons. */
async function expectGateFailure(p: Promise<unknown>, failed: PublishGateFailure[]): Promise<void> {
  const err = await p.then(() => null).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  const appErr = err as AppError;
  expect(appErr.statusCode).toBe(422);
  expect(appErr.code).toBe("LISTING_NOT_PUBLISHABLE");
  expect(appErr.details).toEqual({ failed });
}

const actor = { id: randomUUID() };

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { targetId: { in: listingIds } } });
  await prisma.listingPhoto.deleteMany({ where: { listingId: { in: listingIds } } });
  await prisma.room.deleteMany({ where: { listingId: { in: listingIds } } });
  await prisma.pgListing.deleteMany({ where: { id: { in: listingIds } } });
  await prisma.kycRecord.deleteMany({ where: { userId: { in: hostIds } } });
  await prisma.user.deleteMany({ where: { id: { in: hostIds } } });
  await prisma.$disconnect();
});

describe("listing go-live gate (PRD §9.2)", () => {
  it("guards the constant — a listing needs at least 5 photos", () => {
    expect(MIN_PUBLISH_PHOTOS).toBe(5);
  });

  it("rejects publish (422) when photos < 5", async () => {
    const listing = await makeListing({ photos: 4, kyc: "VERIFIED", pricedRoom: true });
    await expectGateFailure(adminService.publishListing(actor, listing.id), ["photos"]);
    const after = await prisma.pgListing.findUnique({ where: { id: listing.id } });
    expect(after?.status).toBe("PENDING_REVIEW"); // never published
  });

  it("rejects publish (422) when host KYC is not VERIFIED", async () => {
    const pending = await makeListing({ photos: 5, kyc: "PENDING", pricedRoom: true });
    await expectGateFailure(adminService.publishListing(actor, pending.id), ["kyc"]);

    // Also covers the no-KYC-record-at-all case.
    const none = await makeListing({ photos: 5, kyc: null, pricedRoom: true });
    await expectGateFailure(adminService.publishListing(actor, none.id), ["kyc"]);
  });

  it("rejects publish (422) when no room has rent > 0 paise", async () => {
    const listing = await makeListing({ photos: 5, kyc: "VERIFIED", pricedRoom: false });
    await expectGateFailure(adminService.publishListing(actor, listing.id), ["rooms"]);
  });

  it("reports every failing condition together", async () => {
    const listing = await makeListing({ photos: 0, kyc: null, pricedRoom: false });
    await expectGateFailure(adminService.publishListing(actor, listing.id), ["photos", "kyc", "rooms"]);
  });

  it("publishes only when all three conditions pass, and audits the snapshot", async () => {
    const listing = await makeListing({ photos: 5, kyc: "VERIFIED", pricedRoom: true });

    const result = await adminService.publishListing(actor, listing.id);
    expect(result.status).toBe("PUBLISHED");

    const reloaded = await prisma.pgListing.findUnique({ where: { id: listing.id } });
    expect(reloaded?.status).toBe("PUBLISHED");

    const audit = await prisma.auditLog.findFirst({
      where: { targetId: listing.id, action: "listing.published" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(actor.id);
    expect(audit?.metadata).toMatchObject({
      before: { status: "PENDING_REVIEW" },
      after: { status: "PUBLISHED" },
      gate: { photos: 5, kyc: "VERIFIED", hasPricedRoom: true },
    });
  });

  it("returns the passing snapshot from the guard itself", async () => {
    const listing = await makeListing({ photos: 6, kyc: "VERIFIED", pricedRoom: true });
    const snapshot = await assertListingPublishable(listing.id);
    expect(snapshot).toEqual({
      status: "PENDING_REVIEW",
      photoCount: 6,
      kycStatus: "VERIFIED",
      hasPricedRoom: true,
    });
  });

  it("404s when the listing does not exist", async () => {
    const err = await adminService.publishListing(actor, randomUUID()).then(() => null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(404);
    expect((err as AppError).code).toBe("LISTING_NOT_FOUND");
  });

  // The OTHER publish path: a status edit to PUBLISHED must be gated identically,
  // so the gap cannot be reopened through listingService.updateListing.
  it("gates the updateListing status-edit path too", async () => {
    const blocked = await makeListing({ photos: 0, kyc: null, pricedRoom: false });
    await expectGateFailure(
      listingService.updateListing(blocked.id, { status: "PUBLISHED" }),
      ["photos", "kyc", "rooms"],
    );
    const stillDraft = await prisma.pgListing.findUnique({ where: { id: blocked.id } });
    expect(stillDraft?.status).toBe("PENDING_REVIEW");

    const ok = await makeListing({ photos: 5, kyc: "VERIFIED", pricedRoom: true });
    const updated = await listingService.updateListing(ok.id, { status: "PUBLISHED" });
    expect(updated.status).toBe("PUBLISHED");
  });
});
