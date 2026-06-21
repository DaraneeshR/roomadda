/**
 * Remove the dev seed created by `seed-public.ts` (the "Sunrise Residency"
 * listing and its "Seed Host" owner). Idempotent: safe to run repeatedly.
 *   node --import tsx scripts/clean-seed.ts
 *
 * Deleting the listing cascades to its rooms, beds, photos, and ad slots
 * (onDelete: Cascade); the host is removed afterwards. Other dev data is left
 * untouched — this only targets the seed markers.
 */
import { prisma } from "../src/lib/prisma.js";

const SEED_LISTING_ALIAS = "Sunrise Residency";
const SEED_HOST_NAME = "Seed Host";

async function main(): Promise<void> {
  const before = await prisma.pgListing.count();

  const result = await prisma.$transaction(async (tx) => {
    const listings = await tx.pgListing.deleteMany({ where: { alias: SEED_LISTING_ALIAS } });
    // Remove the seed host only once its listing is gone (no dangling owner).
    const hosts = await tx.user.deleteMany({ where: { fullName: SEED_HOST_NAME, role: "HOST" } });
    return { listings: listings.count, hosts: hosts.count };
  });

  const after = await prisma.pgListing.count();
  console.log(
    `clean-seed: deleted ${result.listings} "${SEED_LISTING_ALIAS}" listing(s) and ` +
      `${result.hosts} "${SEED_HOST_NAME}" user(s). Listings ${before} -> ${after}.`,
  );
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
