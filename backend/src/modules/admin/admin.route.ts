import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { adminService } from "./admin.service.js";
import { serviceRequestAdminService } from "./service-request-admin.service.js";
import { hostAdminService } from "./host-admin.service.js";
import { agentAdminService } from "./agent-admin.service.js";
import {
  adminContactHostSchema,
  adminHostsQuerySchema,
  adminAgentsQuerySchema,
  adminInspectionsQuerySchema,
  adminResolveServiceRequestSchema,
  adminServiceRequestsQuerySchema,
  assignVisitSchema,
  bookingSearchSchema,
  cashQuerySchema,
  chatReportsQuerySchema,
  createAgentSchema,
  flagHostSchema,
  idParamSchema,
  kycQuerySchema,
  listingReviewQuerySchema,
  moderateUserSchema,
  paymentSearchSchema,
  rejectSchema,
  takedownSchema,
  updateAgentTerritorySchema,
} from "./admin.schema.js";

/**
 * Admin surface. EVERY route is ADMIN-only and paginated; every state change
 * writes an AuditLog (handled in the service).
 */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.requireRole("ADMIN"));

  // ---- KYC review ----
  app.get("/admin/kyc", async (request) => adminService.listKyc(kycQuerySchema.parse(request.query)));

  app.post("/admin/kyc/:id/approve", async (request) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    return adminService.approveKyc(admin, id, request.ip);
  });

  app.post("/admin/kyc/:id/reject", async (request) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    const { reason } = rejectSchema.parse(request.body);
    return adminService.rejectKyc(admin, id, reason, request.ip);
  });

  // ---- Listing review / publish ----
  app.get("/admin/listings", async (request) =>
    adminService.listListings(listingReviewQuerySchema.parse(request.query)),
  );

  app.post("/admin/listings/:id/publish", async (request) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    return adminService.publishListing(admin, id, request.ip);
  });

  app.post("/admin/listings/:id/suspend", async (request) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    return adminService.suspendListing(admin, id, request.ip);
  });

  // ---- Cash reconciliation ----
  app.get("/admin/agents/cash-in-hand", async (request) =>
    adminService.cashInHand(cashQuerySchema.parse(request.query)),
  );

  app.get("/admin/cash-collections", async (request) =>
    adminService.reconciliationQueue(cashQuerySchema.parse(request.query)),
  );

  // ---- Search ----
  app.get("/admin/bookings", async (request) =>
    adminService.searchBookings(bookingSearchSchema.parse(request.query)),
  );

  app.get("/admin/payments", async (request) =>
    adminService.searchPayments(paymentSearchSchema.parse(request.query)),
  );

  // ---- Maintenance / service requests oversight ----
  app.get("/admin/service-requests", async (request) =>
    adminService.listServiceRequests(adminServiceRequestsQuerySchema.parse(request.query)),
  );

  // Full ticket (who/where + host + comment thread).
  app.get("/admin/service-requests/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return { request: await serviceRequestAdminService.getDetail(id) };
  });

  // Resolve a request on the host's behalf (mandatory reason, audited).
  app.post("/admin/service-requests/:id/resolve", async (request) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    const { reason } = adminResolveServiceRequestSchema.parse(request.body);
    return { request: await serviceRequestAdminService.resolveOnBehalf(admin, id, reason, request.ip) };
  });

  // Contact the host about a request WITHOUT sharing the host's phone (admin note).
  app.post("/admin/service-requests/:id/contact-host", async (request, reply) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    const { message } = adminContactHostSchema.parse(request.body);
    return reply
      .status(201)
      .send({ request: await serviceRequestAdminService.contactHost(admin, id, message, request.ip) });
  });

  // ---- Host management ----
  app.get("/admin/hosts", async (request) => hostAdminService.list(adminHostsQuerySchema.parse(request.query)));

  app.get("/admin/hosts/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return { host: await hostAdminService.getDetail(id) };
  });

  // Suspend / ban / reinstate a host (reason mandatory for suspend/ban).
  app.post("/admin/hosts/:id/moderate", async (request) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    const body = moderateUserSchema.parse(request.body);
    return { host: await hostAdminService.moderate(admin, id, body, request.ip) };
  });

  // Flag a host for poor response (feeds the escalation history).
  app.post("/admin/hosts/:id/flag", async (request, reply) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    const body = flagHostSchema.parse(request.body);
    return reply.status(201).send({ host: await hostAdminService.flag(admin, id, body, request.ip) });
  });

  // Take a listing down with a MANDATORY reason.
  app.post("/admin/listings/:id/takedown", async (request) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    const { reason } = takedownSchema.parse(request.body);
    return hostAdminService.takedownListing(admin, id, reason, request.ip);
  });

  // ---- Agent management ----
  app.get("/admin/agents-list", async (request) =>
    agentAdminService.list(adminAgentsQuerySchema.parse(request.query)),
  );

  // Retune an agent's territory (zone).
  app.patch("/admin/agents/:id/territory", async (request) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    const body = updateAgentTerritorySchema.parse(request.body);
    return { agent: await agentAdminService.updateTerritory(admin, id, body, request.ip) };
  });

  // Suspend / ban / reinstate an agent.
  app.post("/admin/agents/:id/moderate", async (request) => {
    const admin = getAuthUser(request);
    const { id } = idParamSchema.parse(request.params);
    const body = moderateUserSchema.parse(request.body);
    return { agent: await agentAdminService.moderate(admin, id, body, request.ip) };
  });

  // Assign a property-inspection visit to a zone-matched agent.
  app.post("/admin/agent-visits", async (request, reply) => {
    const admin = getAuthUser(request);
    const body = assignVisitSchema.parse(request.body);
    return reply.status(201).send({ visit: await agentAdminService.assignVisit(admin, body, request.ip) });
  });

  // ---- Chat moderation (reported messages) ----
  app.get("/admin/chat/reports", async (request) =>
    adminService.listChatReports(chatReportsQuerySchema.parse(request.query)),
  );

  // ---- Agents (ADMIN-created, zone-scoped; no self-register) ----
  app.post("/admin/agents", async (request, reply) => {
    const admin = getAuthUser(request);
    const body = createAgentSchema.parse(request.body);
    const agent = await adminService.createAgent(admin, body, request.ip);
    return reply.status(201).send({ agent });
  });

  // ---- Property inspection review queue (agents submit here) ----
  app.get("/admin/inspections", async (request) =>
    adminService.listInspections(adminInspectionsQuerySchema.parse(request.query)),
  );
};
