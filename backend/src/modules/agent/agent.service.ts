import { randomUUID } from "node:crypto";
import { Prisma, type InspectionPhoto, type InspectionRecommendation, type PropertyInspection } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { toAgentVisit } from "./agent.serializer.js";
import { AppError } from "../../lib/errors.js";
import { toPage } from "../../lib/pagination.js";
import { writeAudit } from "../../lib/audit.js";
import { assertPaise, formatPaise } from "../../lib/money.js";
import { razorpay } from "../../lib/razorpay.js";
import { objectStorage, type PresignedUpload } from "../../lib/storage.js";
import { paymentLinkSender, buildPayUrl } from "../../lib/payment-link.js";
import { env } from "../../config/env.js";
import { bookingService } from "../booking/booking.service.js";
import type { AgentDashboard, AgentPerformance } from "@roomadda/shared";
import {
  assertBedInZone,
  assertListingInZone,
  assertOwnedVisitInZone,
  assertRoomInZone,
  zoneListingFilter,
  type ZoneListing,
} from "./zone.js";
import type {
  AddInspectionPhotoInput,
  AgentBookingInput,
  AgentCheckInInput,
  AgentVisitsQuery,
  InspectionDraftInput,
} from "./agent.schema.js";

/** A GPS check-in must be within this radius (metres) of the property to validate. */
export const CHECK_IN_RADIUS_M = 200;
/** An inspection needs at least this many geotagged + timestamped photos to submit. */
export const MIN_INSPECTION_PHOTOS = 8;
/** Assisted-booking pay link / hold window: the USER has 2h to pay. */
const ASSISTED_HOLD_TTL_MS = 2 * 60 * 60 * 1000;

const visitListingSelect = {
  id: true,
  city: true,
  alias: true,
  actualName: true,
  areaLabel: true,
  fullAddress: true,
  latitude: true,
  longitude: true,
} as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfNextUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Commission earned on one confirmed booking = BPS of its monthly rent (paise). */
function commissionFor(monthlyRentPaise: number): number {
  return Math.floor((monthlyRentPaise * env.AGENT_COMMISSION_BPS) / 10_000);
}

/** Mask a phone for display: keep the +CC + first digit and the last 2 digits. */
function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 4)}${"x".repeat(phone.length - 6)}${phone.slice(-2)}`;
}

const notFound = (): AppError => new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Not found" });

export const agentService = {
  // ---- Dashboard ---------------------------------------------------------
  async dashboard(agentId: string, agentCity: string, now: Date = new Date()): Promise<AgentDashboard> {
    const dayStart = startOfUtcDay(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const monthStart = startOfUtcMonth(now);
    const monthEnd = startOfNextUtcMonth(now);

    const [visits, pendingAssistedBookings, closedThisMonth] = await Promise.all([
      // Today's assigned visits in this zone, ordered by schedule.
      prisma.agentVisit.findMany({
        where: {
          agentId,
          status: { not: "CANCELLED" },
          scheduledAt: { gte: dayStart, lt: dayEnd },
          listing: zoneListingFilter(agentCity),
        },
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
        include: { listing: { select: visitListingSelect }, inspection: { select: { status: true } } },
      }),
      // Agent's assisted bookings still awaiting the user's payment.
      prisma.booking.count({
        where: {
          bookedByAgentId: agentId,
          agentChannel: "ASSISTED",
          status: { in: ["INITIATED", "PENDING_APPROVAL", "TOKEN_PENDING"] },
        },
      }),
      // Agent's bookings CONFIRMED this month (assisted + walk-in).
      prisma.booking.count({
        where: { bookedByAgentId: agentId, status: "CONFIRMED", confirmedAt: { gte: monthStart, lt: monthEnd } },
      }),
    ]);

    return {
      todaysVisits: visits.map((v) => toAgentVisit(v)),
      pendingAssistedBookings,
      closedThisMonth,
      generatedAt: now.toISOString(),
    };
  },

  // ---- Performance scorecard (read-only; manual payout in MVP) -----------
  async performance(agentId: string, agentCity: string, now: Date = new Date()): Promise<AgentPerformance> {
    const monthStart = startOfUtcMonth(now);
    const monthEnd = startOfNextUtcMonth(now);

    const [visitsCompleted, confirmed] = await Promise.all([
      prisma.agentVisit.count({
        where: {
          agentId,
          status: "COMPLETED",
          visitedAt: { gte: monthStart, lt: monthEnd },
          listing: zoneListingFilter(agentCity),
        },
      }),
      prisma.booking.findMany({
        where: { bookedByAgentId: agentId, status: "CONFIRMED", confirmedAt: { gte: monthStart, lt: monthEnd } },
        select: { agentChannel: true, monthlyRentPaise: true },
      }),
    ]);

    let assistedClosed = 0;
    let walkInClosed = 0;
    let commissionEarnedPaise = 0;
    for (const b of confirmed) {
      if (b.agentChannel === "WALK_IN") walkInClosed++;
      else assistedClosed++;
      commissionEarnedPaise += commissionFor(b.monthlyRentPaise);
    }

    return {
      periodMonth: monthStart.toISOString(),
      periodLabel: `${MONTHS[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
      visitsCompleted,
      bookingsClosed: confirmed.length,
      assistedClosed,
      walkInClosed,
      commissionEarnedPaise,
      generatedAt: now.toISOString(),
    };
  },

  // ---- Visits ------------------------------------------------------------
  async listVisits(agentId: string, agentCity: string, query: AgentVisitsQuery) {
    const rows = await prisma.agentVisit.findMany({
      where: {
        agentId,
        ...(query.status ? { status: query.status } : {}),
        listing: zoneListingFilter(agentCity),
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { listing: { select: visitListingSelect }, inspection: { select: { status: true } } },
    });
    return toPage(rows, query.limit);
  },

  async getVisit(agentId: string, agentCity: string, visitId: string) {
    await assertOwnedVisitInZone(agentId, agentCity, visitId);
    const visit = await prisma.agentVisit.findUnique({
      where: { id: visitId },
      include: { listing: { select: visitListingSelect }, inspection: { select: { status: true } } },
    });
    if (!visit) throw notFound();
    return visit;
  },

  // ---- GPS check-in ------------------------------------------------------
  /**
   * Record a GPS check-in for a visit. PostGIS ST_DWithin against the property
   * geography validates the point is within 200m. An out-of-range point is still
   * recorded (the "cannot reach property" flag path) but does NOT validate — an
   * inspection can be submitted only on a valid check-in.
   */
  async checkIn(agentId: string, agentCity: string, visitId: string, input: AgentCheckInInput) {
    const { listing } = await assertOwnedVisitInZone(agentId, agentCity, visitId);

    const rows = await prisma.$queryRaw<Array<{ within: boolean; distance_m: number | null }>>`
      SELECT
        ST_DWithin(location, ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography, ${CHECK_IN_RADIUS_M}) AS within,
        ST_Distance(location, ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography) AS distance_m
      FROM pg_listings
      WHERE id = ${listing.id}::uuid AND location IS NOT NULL
    `;
    const row = rows[0];
    const withinRange = row?.within === true;
    const distanceM = row?.distance_m ?? null;

    const at = new Date();
    await prisma.agentVisit.update({
      where: { id: visitId },
      data: {
        checkInLat: input.lat,
        checkInLng: input.lng,
        checkInAt: at,
        checkInDistanceM: distanceM,
        checkInValid: withinRange,
      },
    });

    return {
      visitId,
      withinRange,
      // The out-of-range flag path — recorded, surfaced, but not a valid check-in.
      cannotReachProperty: !withinRange,
      distanceM,
      radiusM: CHECK_IN_RADIUS_M,
      checkedInAt: at.toISOString(),
    };
  },

  // ---- Inspection (partial-save / resume + submit) -----------------------
  async getInspection(agentId: string, agentCity: string, visitId: string) {
    await assertOwnedVisitInZone(agentId, agentCity, visitId);
    return prisma.propertyInspection.findUnique({ where: { visitId }, include: { photos: true } });
  },

  /** Upsert the inspection DRAFT for a visit (partial-save/resume). */
  async saveInspection(agentId: string, agentCity: string, visitId: string, input: InspectionDraftInput) {
    const { visit } = await assertOwnedVisitInZone(agentId, agentCity, visitId);
    // A submitted inspection is locked — check BEFORE writing so the upsert below
    // can never mutate a SUBMITTED row.
    const existing = await prisma.propertyInspection.findUnique({ where: { visitId }, select: { status: true } });
    if (existing && existing.status !== "DRAFT") {
      throw new AppError({ statusCode: 409, code: "INSPECTION_LOCKED", message: "Inspection already submitted" });
    }
    const data = draftToData(input);
    return prisma.propertyInspection.upsert({
      where: { visitId },
      create: { visitId, agentId, listingId: visit.listingId, status: "DRAFT", ...data },
      update: data,
      include: { photos: true },
    });
  },

  /** Presign a PUT URL for one inspection photo (key scoped to the visit). */
  async presignInspectionPhoto(
    agentId: string,
    agentCity: string,
    visitId: string,
    contentType: "image/jpeg" | "image/png",
  ): Promise<PresignedUpload> {
    await assertOwnedVisitInZone(agentId, agentCity, visitId);
    const ext = contentType === "image/png" ? "png" : "jpg";
    const key = `inspections/${visitId}/${randomUUID()}.${ext}`;
    return objectStorage.presignUpload({ key, contentType });
  },

  /** Attach a geotagged + timestamped photo to the visit's inspection draft. */
  async addInspectionPhoto(agentId: string, agentCity: string, visitId: string, input: AddInspectionPhotoInput) {
    const { visit } = await assertOwnedVisitInZone(agentId, agentCity, visitId);
    // The key MUST belong to this visit's prefix (no cross-visit/forged keys).
    if (!input.key.startsWith(`inspections/${visitId}/`)) {
      throw new AppError({ statusCode: 400, code: "INVALID_PHOTO_KEY", message: "Photo key does not belong to this visit" });
    }
    const existing = await prisma.propertyInspection.findUnique({ where: { visitId }, select: { status: true } });
    if (existing && existing.status !== "DRAFT") {
      throw new AppError({ statusCode: 409, code: "INSPECTION_LOCKED", message: "Inspection already submitted" });
    }
    const inspection = await prisma.propertyInspection.upsert({
      where: { visitId },
      create: { visitId, agentId, listingId: visit.listingId, status: "DRAFT" },
      update: {},
    });
    await prisma.inspectionPhoto.create({
      data: { inspectionId: inspection.id, objectKey: input.key, lat: input.lat, lng: input.lng, takenAt: input.takenAt },
    });
    return prisma.propertyInspection.findUniqueOrThrow({ where: { visitId }, include: { photos: true } });
  },

  /**
   * Submit the inspection. Gates: the visit must have a VALID check-in, the draft
   * must carry the required fields, and there must be at least
   * {@link MIN_INSPECTION_PHOTOS} geotagged + timestamped photos. On success the
   * inspection enters the admin review queue (SUBMITTED) and the visit is marked
   * COMPLETED.
   */
  async submitInspection(agentId: string, agentCity: string, visitId: string) {
    const { visit } = await assertOwnedVisitInZone(agentId, agentCity, visitId);

    if (visit.checkInValid !== true) {
      throw new AppError({
        statusCode: 409,
        code: "CHECK_IN_REQUIRED",
        message: "A valid GPS check-in within 200m of the property is required before submitting",
      });
    }

    const inspection = await prisma.propertyInspection.findUnique({ where: { visitId }, include: { photos: true } });
    if (!inspection) {
      throw new AppError({ statusCode: 404, code: "INSPECTION_NOT_FOUND", message: "Start the inspection before submitting" });
    }
    if (inspection.status !== "DRAFT") {
      throw new AppError({ statusCode: 409, code: "INSPECTION_LOCKED", message: "Inspection already submitted" });
    }

    if (inspection.photos.length < MIN_INSPECTION_PHOTOS) {
      throw new AppError({
        statusCode: 422,
        code: "INSUFFICIENT_PHOTOS",
        message: `At least ${MIN_INSPECTION_PHOTOS} geotagged photos are required`,
        details: { required: MIN_INSPECTION_PHOTOS, have: inspection.photos.length },
      });
    }

    const missing = requiredInspectionFieldsMissing(inspection);
    if (missing.length > 0) {
      throw new AppError({
        statusCode: 422,
        code: "INSPECTION_INCOMPLETE",
        message: "The inspection is missing required fields",
        details: { missing },
      });
    }

    const [updated] = await prisma.$transaction([
      prisma.propertyInspection.update({
        where: { visitId },
        data: { status: "SUBMITTED", submittedAt: new Date() },
        include: { photos: true },
      }),
      prisma.agentVisit.update({ where: { id: visitId }, data: { status: "COMPLETED", visitedAt: new Date() } }),
    ]);
    await writeAudit({ actorId: agentId, action: "inspection.submitted", targetId: updated.id, metadata: { visitId } });
    return updated;
  },

  // ---- Assisted booking (pay link to the USER; agent CANNOT pay) ---------
  async createAssistedBooking(agentId: string, agentCity: string, input: AgentBookingInput) {
    const { listing } = await resolveTarget(agentCity, input);
    const tenant = await resolveTenantUser(input.tenantName, input.tenantPhone);

    const booking = await bookingService.createBookingHold(
      tenant.id,
      bookingInput(input),
      { agentId, channel: "ASSISTED", holdTtlMs: ASSISTED_HOLD_TTL_MS },
    );

    if (booking.status !== "TOKEN_PENDING") {
      // Request-to-Book listing: payment is blocked until the host accepts, so no
      // link is sent yet. (The agent flow targets instant-book inventory.)
      throw new AppError({
        statusCode: 409,
        code: "REQUIRES_HOST_APPROVAL",
        message: "This property needs host approval before a pay link can be sent",
      });
    }

    // Create the Razorpay order + payment server-side, then send the link to the
    // USER. The agent never receives a payable order — they cannot pay.
    const order = await initiateAgentOrder(booking.id, booking.tokenAmountPaise);
    await paymentLinkSender.sendAssistedBookingLink({
      toPhone: tenant.phone,
      tenantName: tenant.fullName,
      listingAlias: listing.alias,
      amountText: formatPaise(booking.tokenAmountPaise),
      payUrl: buildPayUrl(booking.id, order.id),
      expiresAt: booking.holdExpiresAt ?? new Date(Date.now() + ASSISTED_HOLD_TTL_MS),
    });
    await writeAudit({
      actorId: agentId,
      action: "agent.assisted_booking.created",
      targetId: booking.id,
      metadata: { tenantId: tenant.id, listingId: listing.id, channel: "ASSISTED" },
    });

    return {
      bookingId: booking.id,
      status: booking.status,
      tenantId: tenant.id,
      agentChannel: "ASSISTED" as const,
      tokenAmountPaise: booking.tokenAmountPaise,
      payLinkSentTo: maskPhone(tenant.phone),
      expiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    };
  },

  // ---- Walk-in booking (user scans an agent-shown QR; webhook confirms) --
  async createWalkInBooking(agentId: string, agentCity: string, input: AgentBookingInput) {
    const { listing } = await resolveTarget(agentCity, input);
    const tenant = await resolveTenantUser(input.tenantName, input.tenantPhone);

    const booking = await bookingService.createBookingHold(
      tenant.id,
      bookingInput(input),
      { agentId, channel: "WALK_IN", holdTtlMs: ASSISTED_HOLD_TTL_MS },
    );
    if (booking.status !== "TOKEN_PENDING") {
      throw new AppError({
        statusCode: 409,
        code: "REQUIRES_HOST_APPROVAL",
        message: "This property needs host approval before a QR can be generated",
      });
    }

    const order = await initiateAgentOrder(booking.id, booking.tokenAmountPaise);
    await writeAudit({
      actorId: agentId,
      action: "agent.walkin_booking.created",
      targetId: booking.id,
      metadata: { tenantId: tenant.id, listingId: listing.id, channel: "WALK_IN" },
    });

    return {
      bookingId: booking.id,
      status: booking.status,
      tenantId: tenant.id,
      agentChannel: "WALK_IN" as const,
      tokenAmountPaise: booking.tokenAmountPaise,
      // The user scans this on their own device; the webhook is the ONLY confirm path.
      razorpayOrder: { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID },
      expiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    };
  },

  // ---- Attributed booking status (walk-in / assisted poll target) --------
  /**
   * The live status of ONE booking THIS agent created. The walk-in flow polls
   * this so confirmation reflects the SPECIFIC booking's webhook settlement — not
   * an aggregate counter (closedThisMonth) that any other in-scope confirmation
   * would also move. A booking the agent did not create (bookedByAgentId != caller)
   * is a 404, and even the agent's own booking is denied if its property sits
   * outside their zone (§9.1); either miss is indistinguishable from a missing id.
   */
  async getAttributedBooking(agentId: string, agentCity: string, bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        agentChannel: true,
        confirmedAt: true,
        bookedByAgentId: true,
        listingId: true,
      },
    });
    if (!booking || booking.bookedByAgentId !== agentId) throw notFound();
    await assertListingInZone(agentCity, booking.listingId);
    return booking;
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve an assisted/walk-in target (room or bed) to its in-zone listing. */
async function resolveTarget(agentCity: string, input: AgentBookingInput): Promise<{ listing: ZoneListing }> {
  if (input.bedId) return { listing: (await assertBedInZone(agentCity, input.bedId)).listing };
  return { listing: (await assertRoomInZone(agentCity, input.roomId!)).listing };
}

/** Strip the agent-only fields, leaving the shape the booking hold expects. */
function bookingInput(input: AgentBookingInput) {
  return {
    ...(input.bedId ? { bedId: input.bedId } : {}),
    ...(input.roomId ? { roomId: input.roomId } : {}),
    ...(input.moveInDate ? { moveInDate: input.moveInDate } : {}),
  };
}

/** Find a tenant by phone, or create an unverified TENANT (the agent vouches). */
async function resolveTenantUser(name: string, phone: string): Promise<{ id: string; phone: string; fullName: string }> {
  const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true, phone: true, fullName: true } });
  if (existing) return existing;
  return prisma.user.create({
    data: { phone, fullName: name, role: "TENANT", isPhoneVerified: false },
    select: { id: true, phone: true, fullName: true },
  });
}

/**
 * Create the token Razorpay order + Payment for an agent-created booking. Mirrors
 * paymentService.createTokenPayment's ONLINE leg but is initiated by the AGENT
 * (no tenant ownership check). NEVER captures — the verified webhook is the only
 * thing that captures/confirms (the agent cannot move money).
 */
async function initiateAgentOrder(
  bookingId: string,
  tokenAmountPaise: number,
): Promise<{ id: string; amount: number; currency: string }> {
  assertPaise(tokenAmountPaise);
  if (await prisma.payment.findUnique({ where: { bookingId }, select: { id: true } })) {
    throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
  }
  const order = await razorpay.createOrder(tokenAmountPaise, `booking_${bookingId}`);
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: { bookingId, amountPaise: tokenAmountPaise, method: "RAZORPAY", status: "CREATED", razorpayOrderId: order.id },
      });
      await tx.paymentTransaction.create({
        data: { paymentId: payment.id, amountPaise: tokenAmountPaise, status: "CREATED", method: "RAZORPAY" },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError({ statusCode: 409, code: "PAYMENT_EXISTS", message: "A payment has already been initiated" });
    }
    throw err;
  }
  return order;
}

/** Plain scalar patch shape — assignable to both Prisma create and update inputs. */
interface InspectionDraftData {
  amenities?: Prisma.InputJsonValue;
  roomCountListed?: number;
  roomCountActual?: number;
  cleanliness?: Prisma.InputJsonValue;
  securityInfra?: Prisma.InputJsonValue;
  discrepancies?: string | null;
  recommendation?: InspectionRecommendation;
  notesForAdmin?: string | null;
}

/** Map a validated draft patch to plain data (JSON fields cast through). */
function draftToData(input: InspectionDraftInput): InspectionDraftData {
  const data: InspectionDraftData = {};
  if (input.amenities !== undefined) data.amenities = input.amenities as Prisma.InputJsonValue;
  if (input.roomCountListed !== undefined) data.roomCountListed = input.roomCountListed;
  if (input.roomCountActual !== undefined) data.roomCountActual = input.roomCountActual;
  if (input.cleanliness !== undefined) data.cleanliness = input.cleanliness as Prisma.InputJsonValue;
  if (input.securityInfra !== undefined) data.securityInfra = input.securityInfra as Prisma.InputJsonValue;
  if (input.discrepancies !== undefined) data.discrepancies = input.discrepancies;
  if (input.recommendation !== undefined) data.recommendation = input.recommendation;
  if (input.notesForAdmin !== undefined) data.notesForAdmin = input.notesForAdmin;
  return data;
}

/** Which required fields a draft still lacks before it can be submitted. */
function requiredInspectionFieldsMissing(
  inspection: PropertyInspection & { photos: InspectionPhoto[] },
): string[] {
  const missing: string[] = [];
  if (inspection.recommendation === null) missing.push("recommendation");
  if (inspection.roomCountActual === null) missing.push("roomCountActual");
  const amenities = inspection.amenities as Record<string, unknown> | null;
  if (!amenities || Object.keys(amenities).length === 0) missing.push("amenities");
  const cleanliness = inspection.cleanliness as Record<string, unknown> | null;
  if (!cleanliness || Object.keys(cleanliness).length === 0) missing.push("cleanliness");
  return missing;
}
