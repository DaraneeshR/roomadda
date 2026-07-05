import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { agentService } from "./agent.service.js";
import { agentErpService } from "./agent.erp.service.js";
import { getAgentCity } from "./zone.js";
import { toAgentBookingStatus, toAgentVisit, toInspection } from "./agent.serializer.js";
import {
  addInspectionPhotoSchema,
  agentBookingIdParamSchema,
  agentBookingSchema,
  agentCheckInSchema,
  agentErpBookingIdParamSchema,
  agentErpBookingsQuerySchema,
  agentErpUploadUrlSchema,
  agentSubmitBookingSchema,
  agentVisitsQuerySchema,
  inspectionDraftSchema,
  inspectionPhotoUrlSchema,
  visitIdParamSchema,
} from "./agent.schema.js";

/**
 * Agent surface — every endpoint the agent (host_agent) app consumes. Agents are
 * ADMIN-created, AGENT-only (default-deny via requireRole), and ZONE-SCOPED: the
 * §9.1 zone-access invariant is enforced server-side on every route by resolving
 * the agent's `assignedCity` (getAgentCity) and confining every read/action to it
 * (zone.ts). A cross-zone id is a 404 — existence is never leaked across zones.
 */
export const agentRoutes: FastifyPluginAsync = async (app) => {
  // Default-deny: authenticated AGENT only. ADMIN uses the admin surface; an
  // admin is intentionally NOT zone-exempt here because these are agent self-views.
  const guard = { preHandler: [app.authenticate, app.requireRole("AGENT")] };

  // Dashboard: today's assigned visits, pending assisted bookings, month's closed.
  app.get("/agent/dashboard", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    return reply.send(await agentService.dashboard(user.id, city));
  });

  // Performance scorecard (read-only; manual payout in MVP).
  app.get("/agent/performance", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    return reply.send(await agentService.performance(user.id, city));
  });

  // List the agent's visits (zone-scoped), cursor-paginated.
  app.get("/agent/visits", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const query = agentVisitsQuerySchema.parse(request.query);
    const page = await agentService.listVisits(user.id, city, query);
    return reply.send({ items: page.items.map((v) => toAgentVisit(v)), nextCursor: page.nextCursor });
  });

  // One visit (own + in-zone).
  app.get("/agent/visits/:id", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const { id } = visitIdParamSchema.parse(request.params);
    const visit = await agentService.getVisit(user.id, city, id);
    return reply.send({ visit: toAgentVisit(visit) });
  });

  // GPS check-in. Records coords + time; returns the within-200m flag (an
  // out-of-range point is recorded but does NOT validate — flag path, not a pass).
  app.post("/agent/visits/:id/check-in", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const { id } = visitIdParamSchema.parse(request.params);
    const body = agentCheckInSchema.parse(request.body);
    return reply.send(await agentService.checkIn(user.id, city, id, body));
  });

  // Resume an inspection draft (null if not started).
  app.get("/agent/visits/:id/inspection", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const { id } = visitIdParamSchema.parse(request.params);
    const inspection = await agentService.getInspection(user.id, city, id);
    return reply.send({ inspection: inspection ? toInspection(inspection) : null });
  });

  // Partial-save the inspection checklist (DRAFT).
  app.put("/agent/visits/:id/inspection", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const { id } = visitIdParamSchema.parse(request.params);
    const body = inspectionDraftSchema.parse(request.body);
    const inspection = await agentService.saveInspection(user.id, city, id, body);
    return reply.send({ inspection: toInspection(inspection) });
  });

  // Presigned PUT for one inspection photo (key scoped to the visit).
  app.post("/agent/visits/:id/inspection/photo-url", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const { id } = visitIdParamSchema.parse(request.params);
    const { contentType } = inspectionPhotoUrlSchema.parse(request.body);
    return reply.send(await agentService.presignInspectionPhoto(user.id, city, id, contentType));
  });

  // Attach a geotagged + timestamped photo to the draft.
  app.post("/agent/visits/:id/inspection/photos", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const { id } = visitIdParamSchema.parse(request.params);
    const body = addInspectionPhotoSchema.parse(request.body);
    const inspection = await agentService.addInspectionPhoto(user.id, city, id, body);
    return reply.status(201).send({ inspection: toInspection(inspection) });
  });

  // Submit the inspection (requires a valid check-in + >=8 photos + required fields).
  app.post("/agent/visits/:id/inspection/submit", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const { id } = visitIdParamSchema.parse(request.params);
    const inspection = await agentService.submitInspection(user.id, city, id);
    return reply.send({ inspection: toInspection(inspection) });
  });

  // Assisted booking — the pay link goes to the USER (the agent CANNOT pay).
  app.post("/agent/assisted-bookings", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const body = agentBookingSchema.parse(request.body);
    return reply.status(201).send(await agentService.createAssistedBooking(user.id, city, body));
  });

  // Walk-in booking — the user scans the returned Razorpay QR; webhook confirms.
  app.post("/agent/walkin-bookings", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const body = agentBookingSchema.parse(request.body);
    return reply.status(201).send(await agentService.createWalkInBooking(user.id, city, body));
  });

  // One agent-created booking's live status (own attribution + in-zone). The
  // walk-in flow polls THIS to detect the webhook-driven CONFIRMED for the
  // specific booking — never an aggregate counter, which any other in-scope
  // confirmation would move. Not the agent's own booking / out-of-zone → 404.
  app.get("/agent/bookings/:id", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const { id } = agentBookingIdParamSchema.parse(request.params);
    const booking = await agentService.getAttributedBooking(user.id, city, id);
    return reply.send(toAgentBookingStatus(booking));
  });

  // ---- ERP-6: the scoped agent ERP view (§15.4). Self + zone scoped; the agent
  // sees ONLY their own bookings/commission/rank — never another agent's data nor
  // any company-finance figure. getAgentCity is called so a zoneless agent is
  // default-denied (403) on every ERP route too. ----

  // Home: my bookings / approved / commission / monthly leaderboard rank.
  app.get("/agent/erp/home", guard, async (request, reply) => {
    const user = getAuthUser(request);
    await getAgentCity(user.id);
    return reply.send(await agentErpService.home(user.id));
  });

  // My bookings ledger (own only), each with the gross commission I earned.
  app.get("/agent/erp/bookings", guard, async (request, reply) => {
    const user = getAuthUser(request);
    await getAgentCity(user.id);
    const query = agentErpBookingsQuerySchema.parse(request.query);
    return reply.send(await agentErpService.listBookings(user.id, query));
  });

  // My performance scorecard: totals, conversion %, commission, incentive, rank.
  app.get("/agent/erp/performance", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    return reply.send(await agentErpService.performance(user.id, city));
  });

  // Presign a PUT URL for one camera-KYC / payment-proof image (before submit).
  app.post("/agent/erp/uploads/url", guard, async (request, reply) => {
    const user = getAuthUser(request);
    await getAgentCity(user.id);
    const { purpose, contentType } = agentErpUploadUrlSchema.parse(request.body);
    return reply.send(await agentErpService.presignUpload(user.id, purpose, contentType));
  });

  // Submit an offline booking → PENDING_APPROVAL → the SHARED admin approval queue.
  app.post("/agent/erp/submissions", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const body = agentSubmitBookingSchema.parse(request.body);
    return reply.status(201).send(await agentErpService.submit(user.id, city, body, request.ip));
  });

  // Open one of MY bookings in full (customer, docs, room, commission earned).
  // Not my booking / out-of-zone → 404 (existence never leaked).
  app.get("/agent/erp/bookings/:bookingId", guard, async (request, reply) => {
    const user = getAuthUser(request);
    const city = await getAgentCity(user.id);
    const { bookingId } = agentErpBookingIdParamSchema.parse(request.params);
    return reply.send(await agentErpService.bookingDetail(user.id, city, bookingId, request.ip));
  });
};
