import type { FastifyPluginAsync } from "fastify";
import type { Booking } from "@prisma/client";
import { getAuthUser } from "../../plugins/auth.js";
import { bookingService } from "./booking.service.js";
import { paymentService } from "./payment.service.js";
import { toBookingDetail } from "./booking.serializer.js";
import {
  bookingIdParamSchema,
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

  // Place a hold — TENANT with VERIFIED KYC only (just-in-time KYC gate).
  app.post(
    "/bookings",
    { preHandler: [app.authenticate, app.requireRole("TENANT"), app.requireKyc] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const body = createBookingSchema.parse(request.body);
      const booking = await bookingService.createBookingHold(user.id, {
        bedId: body.bedId,
        moveInDate: body.moveInDate,
      });
      return reply.status(201).send({ booking: serializeBooking(booking) });
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
