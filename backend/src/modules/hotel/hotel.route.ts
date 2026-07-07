import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { hotelService } from "./hotel.service.js";
import { hotelPaymentService } from "./hotel.payment.service.js";
import { refundService } from "../refund/refund.service.js";
import { toHotelReservation } from "./hotel.serializer.js";
import { buildHotelReceiptPdf } from "./hotel.receipt.js";
import {
  cancelHotelReservationSchema,
  createHotelReservationSchema,
  hotelSearchQuerySchema,
  listHotelReservationsQuerySchema,
  reservationIdParamSchema,
} from "./hotel.schema.js";

export const hotelRoutes: FastifyPluginAsync = async (app) => {
  // ===== PUBLIC — availability search (masked, no auth) ===================
  // Browsing is open (just-in-time KYC — /CLAUDE.md rule #5). Returns MASKED
  // HOTEL listings (USER_ONLY|BOTH only) with server-owned price + real availability.
  app.get("/hotels/search", async (request) => {
    const query = hotelSearchQuerySchema.parse(request.query);
    const { items, nextCursor, nights } = await hotelService.searchAvailability(query);
    return {
      items,
      nextCursor,
      checkIn: query.checkIn.toISOString().slice(0, 10),
      checkOut: query.checkOut.toISOString().slice(0, 10),
      nights,
      guests: query.guests,
    };
  });

  // ===== TENANT — reservations ============================================

  // List the caller's own reservations, newest first, cursor-paginated.
  app.get(
    "/hotels/reservations",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const query = listHotelReservationsQuerySchema.parse(request.query);
      const page = await hotelService.listForGuest(user.id, query);
      return reply.send({ items: page.items.map(toHotelReservation), nextCursor: page.nextCursor });
    },
  );

  // Read one of the caller's own reservations — the payment screen polls this to
  // observe the webhook-driven transition to CONFIRMED. Non-owner -> 404.
  app.get(
    "/hotels/reservations/:id",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = reservationIdParamSchema.parse(request.params);
      const reservation = await hotelService.getForGuest(id, user.id);
      return reply.send({ reservation: toHotelReservation(reservation) });
    },
  );

  // Hold a room for a date range — TENANT with VERIFIED KYC (just-in-time gate).
  // Price is snapshotted server-side; the overbooking guard makes an overlapping
  // double-book impossible. NEVER confirms (payment is separate + webhook-driven).
  app.post(
    "/hotels/reservations",
    { preHandler: [app.authenticate, app.requireRole("TENANT"), app.requireKyc] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const body = createHotelReservationSchema.parse(request.body);
      const reservation = await hotelService.createReservationHold(user.id, body);
      return reply.status(201).send({ reservation: toHotelReservation(reservation) });
    },
  );

  // Initiate the securing payment — returns the server-side Razorpay order. NEVER
  // confirms; the app success callback is "submitted", never "confirmed".
  app.post(
    "/hotels/reservations/:id/payment",
    { preHandler: [app.authenticate, app.requireRole("TENANT"), app.requireKyc] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = reservationIdParamSchema.parse(request.params);
      const result = await hotelPaymentService.createReservationOrder(id, user.id);
      return reply.status(201).send(result);
    },
  );

  // Cancel — TENANT (own). Refund is computed per policy + INITIATED; it settles
  // ONLY via the verified webhook, so the response reports refundStatus PENDING.
  app.post(
    "/hotels/reservations/:id/cancel",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = reservationIdParamSchema.parse(request.params);
      const { reason } = cancelHotelReservationSchema.parse(request.body ?? {});
      const result = await refundService.cancelHotelReservationByGuest(user.id, id, reason);
      return reply.send(result);
    },
  );

  // Downloadable PDF receipt — TENANT (own), available once CONFIRMED.
  app.get(
    "/hotels/reservations/:id/receipt",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = reservationIdParamSchema.parse(request.params);
      const data = await hotelService.getReceiptData(id, user.id);
      const pdf = await buildHotelReceiptPdf(data);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="roomadda-hotel-receipt-${id}.pdf"`)
        .send(Buffer.from(pdf));
    },
  );
};
