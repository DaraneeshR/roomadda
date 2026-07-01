import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { bookingService } from "../booking/booking.service.js";
import { refundService } from "../refund/refund.service.js";
import { bookingRequestService, toHostBookingRequest } from "./booking-request.service.js";
import { listingIdParamSchema, hostBookingRequestsQuerySchema } from "./host.schema.js";
import { reasonBodySchema } from "@roomadda/shared";

/**
 * Host booking-request feed + accept/decline. Listing and accept/decline are all
 * HOST/ADMIN and ownership-checked: the feed scopes by listing.hostId, and
 * accept/decline reuse the booking/refund services whose ownership checks report
 * a foreign booking as 404. Accept NEVER confirms — only the verified webhook does
 * (/CLAUDE.md domain rule #2). Decline routes through the full-refund branch.
 */
export const bookingRequestRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: [app.authenticate, app.requireRole("HOST", "ADMIN")] };

  app.get("/host/booking-requests", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const query = hostBookingRequestsQuerySchema.parse(request.query);
    const page = await bookingRequestService.listIncoming(user, query);
    return reply.send({ items: page.items.map((b) => toHostBookingRequest(b)), nextCursor: page.nextCursor });
  });

  // Accept a Request-to-Book hold — unlocks payment, sends the tenant the link.
  app.post("/host/booking-requests/:id/accept", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    const booking = await bookingService.acceptBooking(user, id);
    return reply.send({ bookingId: booking.id, status: booking.status, holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null });
  });

  // Decline / mark unavailable — full refund initiated for the tenant.
  app.post("/host/booking-requests/:id/decline", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = listingIdParamSchema.parse(request.params);
    const { reason } = reasonBodySchema.partial().parse(request.body ?? {});
    const result = await refundService.declineByHostOrAdmin(user, id, reason);
    return reply.send(result);
  });
};
