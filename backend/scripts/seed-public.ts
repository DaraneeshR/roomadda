/**
 * Seed one PUBLISHED listing + an APPROVED, in-window featured ad so the public
 * website has data to render. The masked fields carry obvious markers so a leak
 * is easy to detect. Prints the listing id.
 *   node --import tsx scripts/seed-public.ts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";

async function main(): Promise<void> {
  const host = await prisma.user.create({
    data: {
      phone: "+9119" + Math.floor(Math.random() * 1e8).toString().padStart(8, "0"),
      fullName: "Seed Host",
      role: "HOST",
      isPhoneVerified: true,
    },
  });
  const listing = await prisma.pgListing.create({
    data: {
      hostId: host.id,
      alias: "Sunrise Residency",
      areaLabel: "Koramangala",
      city: "Bengaluru",
      // Masked (must NEVER appear in public HTML):
      actualName: "SECRET-Sunrise Owner Pvt Ltd",
      fullAddress: "42 SECRETLANE, 5th Block",
      pincode: "560034",
      latitude: 12.9352,
      longitude: 77.6245,
      status: "PUBLISHED",
      amenities: ["wifi", "food", "laundry"],
    },
  });
  const room = await prisma.room.create({
    data: { listingId: listing.id, name: "Deluxe", sharingType: 2, monthlyRentPaise: 1_200_000, depositPaise: 2_400_000 },
  });
  await prisma.bed.create({ data: { roomId: room.id, label: "A1", status: "AVAILABLE" } });
  await prisma.listingPhoto.create({
    data: { listingId: listing.id, url: "https://picsum.photos/seed/roomadda/800/600", isPrimary: true, sortOrder: 0 },
  });
  await prisma.adPricing.upsert({
    where: { slotType: "DAY" },
    create: { slotType: "DAY", pricePaise: 50_000, isActive: true },
    update: { isActive: true },
  });
  const now = new Date();
  await prisma.adSlot.create({
    data: {
      listingId: listing.id,
      createdById: host.id,
      slotType: "DAY",
      startDate: new Date(now.getTime() - 3_600_000),
      endDate: new Date(now.getTime() + 86_400_000),
      pricePaise: 50_000,
      status: "APPROVED",
      approvedById: host.id,
      approvedAt: now,
      razorpayOrderId: `seed_${randomUUID()}`,
    },
  });

  console.log(`SEED_LISTING_ID=${listing.id}`);
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
