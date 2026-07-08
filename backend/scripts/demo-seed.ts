/**
 * Demo seed — brings the whole platform to a walkable state with ZERO external
 * services. Run with:  pnpm --filter @roomadda/backend demo:seed
 *
 * Idempotent: every row has a fixed id (or a natural unique key) and is written
 * with `upsert`, so re-running updates in place and never creates duplicates.
 *
 * It seeds only what the demo needs, all satisfying the real invariants:
 *   - a VERIFIED HOST with 3 PUBLISHED listings that pass the §9.2 go-live gate
 *     (>=5 photos each, host KYC VERIFIED, priced rooms with AVAILABLE beds);
 *   - a TENANT with VERIFIED KYC (booking path unblocked) + one plain tenant;
 *   - an AGENT whose assignedCity matches the listings' city, with a scheduled
 *     visit on one of them;
 *   - an ADMIN (so the webadmin console can be logged into).
 *
 * It writes directly via Prisma (not the API), so it depends only on Postgres —
 * no Redis, no gateways, no cloud. DATABASE_URL is read from backend/.env
 * (dotenv, same as the server). Photos use public placeholder image URLs so the
 * publish gate passes and cards render; if you are fully offline the images just
 * won't load — the data is still valid.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CITY = "Bengaluru";

// Fixed ids → deterministic, upsertable, idempotent. (Valid v4 UUID shape.)
const LISTING_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
] as const;

/** Demo accounts. Phones are E.164 (+91 + 10 digits) — the numbers you log in with. */
const ACCOUNTS = {
  admin: { id: "a0000000-0000-4000-8000-000000000001", phone: "+919000000001", fullName: "Aditi Admin" },
  host: { id: "b0000000-0000-4000-8000-000000000001", phone: "+919000000002", fullName: "Harish Host" },
  tenantVerified: { id: "c0000000-0000-4000-8000-000000000001", phone: "+919000000003", fullName: "Tanvi Tenant" },
  tenantPlain: { id: "c0000000-0000-4000-8000-000000000002", phone: "+919000000004", fullName: "Rahul Renter" },
  agent: { id: "d0000000-0000-4000-8000-000000000001", phone: "+919000000005", fullName: "Anil Agent" },
} as const;

/** One listing's demo shape. Coordinates are real Bengaluru neighbourhoods. */
interface ListingSpec {
  id: string;
  n: number;
  alias: string;
  actualName: string;
  areaLabel: string;
  fullAddress: string;
  pincode: string;
  latitude: number;
  longitude: number;
  gender: "MALE" | "FEMALE" | "COED";
  amenities: string[];
  monthlyRentPaise: number;
  depositPaise: number;
  tokenAmountPaise: number;
}

const LISTINGS: ListingSpec[] = [
  {
    id: LISTING_IDS[0],
    n: 1,
    alias: "Sunrise PG · Koramangala",
    actualName: "Sunrise Residency",
    areaLabel: "Koramangala",
    fullAddress: "148, 5th Block, Koramangala, Bengaluru",
    pincode: "560095",
    latitude: 12.9352,
    longitude: 77.6245,
    gender: "COED",
    amenities: ["WIFI", "MEALS", "LAUNDRY", "POWER_BACKUP"],
    monthlyRentPaise: 1_200_000, // ₹12,000
    depositPaise: 1_200_000,
    tokenAmountPaise: 200_000, // ₹2,000
  },
  {
    id: LISTING_IDS[1],
    n: 2,
    alias: "Green Nest PG · HSR Layout",
    actualName: "Green Nest Boys PG",
    areaLabel: "HSR Layout",
    fullAddress: "22, Sector 2, HSR Layout, Bengaluru",
    pincode: "560102",
    latitude: 12.9116,
    longitude: 77.6389,
    gender: "MALE",
    amenities: ["WIFI", "GYM", "PARKING"],
    monthlyRentPaise: 950_000, // ₹9,500
    depositPaise: 950_000,
    tokenAmountPaise: 200_000,
  },
  {
    id: LISTING_IDS[2],
    n: 3,
    alias: "Lakeview PG · Indiranagar",
    actualName: "Lakeview Ladies Stay",
    areaLabel: "Indiranagar",
    fullAddress: "9, 12th Main, Indiranagar, Bengaluru",
    pincode: "560038",
    latitude: 12.9719,
    longitude: 77.6412,
    gender: "FEMALE",
    amenities: ["WIFI", "MEALS", "HOUSEKEEPING", "CCTV"],
    monthlyRentPaise: 1_500_000, // ₹15,000
    depositPaise: 1_500_000,
    tokenAmountPaise: 200_000,
  },
];

async function main(): Promise<void> {
  // --- Accounts (upsert by phone; fixed create id keeps FKs deterministic) ----
  const admin = await prisma.user.upsert({
    where: { phone: ACCOUNTS.admin.phone },
    create: { id: ACCOUNTS.admin.id, phone: ACCOUNTS.admin.phone, fullName: ACCOUNTS.admin.fullName, role: "ADMIN", isPhoneVerified: true },
    update: { fullName: ACCOUNTS.admin.fullName, role: "ADMIN", isPhoneVerified: true },
  });

  const host = await prisma.user.upsert({
    where: { phone: ACCOUNTS.host.phone },
    create: { id: ACCOUNTS.host.id, phone: ACCOUNTS.host.phone, fullName: ACCOUNTS.host.fullName, role: "HOST", isPhoneVerified: true },
    update: { fullName: ACCOUNTS.host.fullName, role: "HOST", isPhoneVerified: true },
  });

  const tenantVerified = await prisma.user.upsert({
    where: { phone: ACCOUNTS.tenantVerified.phone },
    create: {
      id: ACCOUNTS.tenantVerified.id,
      phone: ACCOUNTS.tenantVerified.phone,
      fullName: ACCOUNTS.tenantVerified.fullName,
      role: "TENANT",
      isPhoneVerified: true,
      gender: "FEMALE",
      occupationType: "WORKING_PROFESSIONAL",
    },
    update: { fullName: ACCOUNTS.tenantVerified.fullName, role: "TENANT", isPhoneVerified: true },
  });

  const tenantPlain = await prisma.user.upsert({
    where: { phone: ACCOUNTS.tenantPlain.phone },
    create: { id: ACCOUNTS.tenantPlain.id, phone: ACCOUNTS.tenantPlain.phone, fullName: ACCOUNTS.tenantPlain.fullName, role: "TENANT", isPhoneVerified: true },
    update: { fullName: ACCOUNTS.tenantPlain.fullName, role: "TENANT", isPhoneVerified: true },
  });

  const agent = await prisma.user.upsert({
    where: { phone: ACCOUNTS.agent.phone },
    create: {
      id: ACCOUNTS.agent.id,
      phone: ACCOUNTS.agent.phone,
      fullName: ACCOUNTS.agent.fullName,
      role: "AGENT",
      isPhoneVerified: true,
      assignedCity: CITY, // §9.1 zone: agent may only act on this city
    },
    update: { fullName: ACCOUNTS.agent.fullName, role: "AGENT", isPhoneVerified: true, assignedCity: CITY },
  });

  // --- KYC: host + verified tenant must be VERIFIED --------------------------
  // Host KYC VERIFIED is one of the three §9.2 publish conditions; the tenant's
  // VERIFIED KYC unblocks the just-in-time booking gate (requireKyc).
  const now = new Date();
  for (const userId of [host.id, tenantVerified.id]) {
    await prisma.kycRecord.upsert({
      where: { userId },
      create: { userId, status: "VERIFIED", docType: "AADHAAR", verifiedAt: now },
      update: { status: "VERIFIED", docType: "AADHAAR", verifiedAt: now, rejectedAt: null, rejectReason: null },
    });
  }

  // --- Listings (+ photos, rooms, beds) → all PUBLISHED & gate-passing -------
  for (const spec of LISTINGS) {
    const base = {
      hostId: host.id,
      alias: spec.alias,
      areaLabel: spec.areaLabel,
      city: CITY,
      amenities: spec.amenities,
      actualName: spec.actualName,
      fullAddress: spec.fullAddress,
      pincode: spec.pincode,
      latitude: spec.latitude,
      longitude: spec.longitude,
      status: "PUBLISHED" as const,
      gender: spec.gender,
      instantBook: true, // Instant Book → a paid token confirms immediately
      mealsOffered: spec.amenities.includes("MEALS"),
      tokenAmountPaise: spec.tokenAmountPaise,
      paused: false,
    };
    await prisma.pgListing.upsert({ where: { id: spec.id }, create: { id: spec.id, ...base }, update: base });

    // 5 photos (the §9.2 minimum) — deterministic ids, first is primary.
    for (let i = 1; i <= 5; i++) {
      const photoId = `40000000-0000-4000-8000-${String(spec.n).padStart(3, "0")}${String(i).padStart(9, "0")}`;
      const photo = {
        listingId: spec.id,
        url: `https://picsum.photos/seed/roomadda-${spec.n}-${i}/800/600`,
        isPrimary: i === 1,
        sortOrder: i,
      };
      await prisma.listingPhoto.upsert({ where: { id: photoId }, create: { id: photoId, ...photo }, update: photo });
    }

    // 2 rooms; each with beds (all AVAILABLE so discovery shows availability and
    // the tenant can book). Room 1 = single, Room 2 = 2-sharing.
    for (const r of [1, 2]) {
      const roomId = `20000000-0000-4000-8000-${String(spec.n).padStart(3, "0")}${String(r).padStart(9, "0")}`;
      const sharing = r === 1 ? 1 : 2;
      const room = {
        listingId: spec.id,
        name: r === 1 ? "Room 101 (single)" : "Room 102 (2-sharing)",
        floor: 1,
        sharingType: sharing,
        monthlyRentPaise: spec.monthlyRentPaise,
        depositPaise: spec.depositPaise,
        inventoryVerifiedAt: now,
      };
      await prisma.room.upsert({ where: { id: roomId }, create: { id: roomId, ...room }, update: room });

      for (let b = 1; b <= sharing; b++) {
        const bedId = `30000000-0000-4000-8000-${String(spec.n).padStart(3, "0")}${String(r)}${String(b).padStart(8, "0")}`;
        const bed = { roomId, label: `B${b}`, status: "AVAILABLE" as const, monthlyRentPaise: spec.monthlyRentPaise };
        await prisma.bed.upsert({ where: { id: bedId }, create: { id: bedId, ...bed }, update: bed });
      }
    }
  }

  // --- Agent visit: one scheduled visit on the first listing (same city) -----
  const visitId = "50000000-0000-4000-8000-000000000001";
  const scheduledAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // tomorrow
  const visit = { listingId: LISTING_IDS[0], agentId: agent.id, status: "SCHEDULED" as const, scheduledAt };
  await prisma.agentVisit.upsert({ where: { id: visitId }, create: { id: visitId, ...visit }, update: visit });

  // --- Hotel B2C add-on: one bookable HOTEL property (nightly reservations) ---
  await seedHotel(host.id);

  printSummary();
}

/** Fixed hotel ids → deterministic + idempotent (valid v4 UUID shape). */
const HOTEL_LISTING_ID = "11000000-0000-4000-8000-000000000001";

/**
 * One PUBLISHED HOTEL property (propertyType HOTEL, USER_ONLY so it is B2C-visible)
 * with two room categories and their physical room UNITS. The B2C search + booking
 * flow (/v1/hotels/*) reads exactly this: nightly price + real per-date availability
 * are server-owned; units are what the overbooking guard operates on. The corporate
 * carve-out is exercised (Deluxe reserves 1 room CORPORATE, kept out of the B2C pool).
 */
async function seedHotel(hostId: string): Promise<void> {
  const base = {
    hostId,
    alias: "Skyline Suites · MG Road",
    areaLabel: "MG Road",
    city: CITY,
    amenities: ["WIFI", "AC", "BREAKFAST", "PARKING", "POWER_BACKUP"],
    actualName: "Skyline Suites Hotel",
    fullAddress: "1, MG Road, Bengaluru",
    pincode: "560001",
    latitude: 12.9756,
    longitude: 77.6068,
    status: "PUBLISHED" as const,
    propertyType: "HOTEL" as const,
    visibility: "USER_ONLY" as const, // B2C-visible (never CORPORATE_ONLY)
    gender: "COED" as const,
    paused: false,
  };
  await prisma.pgListing.upsert({
    where: { id: HOTEL_LISTING_ID },
    create: { id: HOTEL_LISTING_ID, ...base },
    update: base,
  });

  // 5 photos so the property card renders (same §9.2 minimum shape as the PGs).
  for (let i = 1; i <= 5; i++) {
    const photoId = `41000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const photo = {
      listingId: HOTEL_LISTING_ID,
      url: `https://picsum.photos/seed/roomadda-hotel-${i}/800/600`,
      isPrimary: i === 1,
      sortOrder: i,
    };
    await prisma.listingPhoto.upsert({ where: { id: photoId }, create: { id: photoId, ...photo }, update: photo });
  }

  // Two categories; each provisions (totalRooms − corporateReservedRooms) B2C units
  // + corporateReservedRooms CORPORATE units, exactly like hotelService.provisionUnits.
  const CATEGORIES = [
    { n: 1, id: "12000000-0000-4000-8000-000000000001", tier: "Deluxe Room", perNightPaise: 300_000, totalRooms: 4, corporate: 1 },
    { n: 2, id: "12000000-0000-4000-8000-000000000002", tier: "Executive Suite", perNightPaise: 550_000, totalRooms: 2, corporate: 0 },
  ] as const;

  for (const c of CATEGORIES) {
    const cat = {
      listingId: HOTEL_LISTING_ID,
      tier: c.tier,
      perNightPaise: c.perNightPaise,
      photos: [`https://picsum.photos/seed/roomadda-hotel-cat-${c.n}/800/600`],
      amenities: base.amenities,
      totalRooms: c.totalRooms,
      corporateReservedRooms: c.corporate,
    };
    await prisma.hotelRoomCategory.upsert({ where: { id: c.id }, create: { id: c.id, ...cat }, update: cat });

    const b2c = c.totalRooms - c.corporate;
    for (let i = 0; i < c.totalRooms; i++) {
      const channel = i < b2c ? ("B2C" as const) : ("CORPORATE" as const);
      const label = channel === "B2C" ? `B2C-${i + 1}` : `CORP-${i - b2c + 1}`;
      const roomId = `13000000-0000-4000-8000-${String(c.n)}${String(i + 1).padStart(11, "0")}`;
      const room = { categoryId: c.id, label, channel };
      await prisma.hotelRoom.upsert({ where: { id: roomId }, create: { id: roomId, ...room }, update: room });
    }
  }
}

function printSummary(): void {
  const line = "─".repeat(64);
  console.log(`\n${line}`);
  console.log("✅  Demo seed complete (idempotent — safe to re-run).");
  console.log(line);
  console.log("Demo accounts (log in with the phone; there are no passwords):\n");
  console.log(`  ADMIN            ${ACCOUNTS.admin.phone}   → webadmin console (localhost:5173)`);
  console.log(`  HOST             ${ACCOUNTS.host.phone}   → host_agent app, 3 published PGs`);
  console.log(`  TENANT (KYC ✔)   ${ACCOUNTS.tenantVerified.phone}   → tenant app, can book`);
  console.log(`  TENANT (plain)   ${ACCOUNTS.tenantPlain.phone}   → tenant app, KYC not done`);
  console.log(`  AGENT            ${ACCOUNTS.agent.phone}   → host_agent app, city ${CITY}, 1 visit`);
  console.log(`\n  Listings: 3 PUBLISHED PGs in ${CITY} (Koramangala, HSR Layout, Indiranagar).`);
  console.log(`  Hotel:    1 PUBLISHED B2C hotel in ${CITY} (Skyline Suites · MG Road) → /hotels`);
  console.log(`\n  🔑  OTP: there is no SMS locally. When you request a code, the`);
  console.log(`      backend terminal logs it as:  DEV_OTP <phone> <code>`);
  console.log(`      Read the 6-digit code from there and type it into the app.`);
  console.log(`${line}\n`);
}

main()
  .catch((err) => {
    console.error("❌  Demo seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
