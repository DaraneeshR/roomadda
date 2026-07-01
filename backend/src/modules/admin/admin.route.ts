import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { adminService } from "./admin.service.js";
import {
  adminInspectionsQuerySchema,
  adminServiceRequestsQuerySchema,
  bookingSearchSchema,
  cashQuerySchema,
  chatReportsQuerySchema,
  createAgentSchema,
  idParamSchema,
  kycQuerySchema,
  listingReviewQuerySchema,
  paymentSearchSchema,
  rejectSchema,
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
