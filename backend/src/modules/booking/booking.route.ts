import type { FastifyPluginAsync } from "fastify";
import type { Booking } from "@prisma/client";
import { getAuthUser } from "../../plugins/auth.js";
import { bookingService } from "./booking.service.js";
import { refundService } from "../refund/refund.service.js";
import { paymentService } from "./payment.service.js";
import { toBookingDetail } from "./booking.serializer.js";
import { buildReceiptPdf } from "./receipt.service.js";
import {
  bookingIdParamSchema,
  cancelBookingSchema,
  createBookingSchema,
  createPaymentSchema,
  listBookingsQuerySchema,
} from "./booking.schema.js";

function serializeBooking(b: Booking) {
  return {
    id: b.id,
    bedId: b.bedId,
    listingId: b.listingId,
    status: b.status,
    tokenAmountPaise: b.tokenAmountPaise,
    monthlyRentPaise: b.monthlyRentPaise,
    depositPaise: b.depositPaise,
    moveInDate: b.moveInDate?.toISOString() ?? null,
    holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
    confirmedAt: b.confirmedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

export const bookingRoutes: FastifyPluginAsync = async (app) => {
  // Read one of the caller's own bookings — TENANT only. The mobile payment
  // screen polls this to observe the webhook-driven transition to CONFIRMED.
  // Ownership lives in the service: another tenant's id returns 404 (never 403),
  // so it cannot be used to probe for existing bookings.
  app.get(
    "/bookings/:id",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = bookingIdParamSchema.parse(request.params);
      const booking = await bookingService.getDetailForTenant(id, user.id);
      return reply.send({ booking: toBookingDetail(booking) });
    },
  );

  // List the caller's own bookings — TENANT only, cursor-paginated, newest first.
  app.get(
    "/bookings",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const query = listBookingsQuerySchema.parse(request.query);
      const page = await bookingService.listForTenant(user.id, query);
      return reply.send({ items: page.items.map(toBookingDetail), nextCursor: page.nextCursor });
    },
  );

  // Place a hold — TENANT with VERIFIED KYC only (just-in-time KYC gate). Accepts
  // a roomId (server picks a bed) or a bedId. Instant Book -> TOKEN_PENDING;
  // Request-to-Book -> PENDING_APPROVAL (payment blocked until the host accepts).
  app.post(
    "/bookings",
    { preHandler: [app.authenticate, app.requireRole("TENANT"), app.requireKyc] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const body = createBookingSchema.parse(request.body);
      const booking = await bookingService.createBookingHold(user.id, body);
      return reply.status(201).send({ booking: serializeBooking(booking) });
    },
  );

  // Host (or admin) accepts a Request-to-Book hold, unlocking payment. NEVER
  // confirms — confirmation still comes only from the verified webhook.
  app.post(
    "/bookings/:id/accept",
    { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = bookingIdParamSchema.parse(request.params);
      const booking = await bookingService.acceptBooking(user, id);
      return reply.send({ booking: serializeBooking(booking) });
    },
  );

  // Cancel a booking — TENANT (own). The refund amount is computed per policy
  // server-side and INITIATED; it settles to refunded ONLY via the verified
  // webhook, so the response reports refundStatus PENDING (never "refunded").
  app.post(
    "/bookings/:id/cancel",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = bookingIdParamSchema.parse(request.params);
      const { reason } = cancelBookingSchema.parse(request.body ?? {});
      const result = await refundService.cancelByTenant(user.id, id, reason);
      return reply.send(result);
    },
  );

  // Decline / mark unavailable — HOST (owner) or ADMIN. Routes through the SAME
  // cancellation core with cancelledBy = HOST, so a full refund is initiated.
  app.post(
    "/bookings/:id/decline",
    { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = bookingIdParamSchema.parse(request.params);
      const { reason } = cancelBookingSchema.parse(request.body ?? {});
      const result = await refundService.declineByHostOrAdmin(user, id, reason);
      return reply.send(result);
    },
  );

  // Downloadable PDF receipt — TENANT (own), available once CONFIRMED.
  app.get(
    "/bookings/:id/receipt",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = bookingIdParamSchema.parse(request.params);
      const data = await bookingService.getReceiptData(id, user.id);
      const pdf = await buildReceiptPdf(data);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="roomadda-receipt-${id}.pdf"`)
        .send(Buffer.from(pdf));
    },
  );

  // Initiate the token payment. NEVER confirms — returns the Razorpay order.
  app.post(
    "/bookings/:id/payment",
    { preHandler: [app.authenticate, app.requireRole("TENANT"), app.requireKyc] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = bookingIdParamSchema.parse(request.params);
      const body = createPaymentSchema.parse(request.body);
      const result = await paymentService.createTokenPayment(id, user.id, body);
      return reply.status(201).send(result);
    },
  );
};
