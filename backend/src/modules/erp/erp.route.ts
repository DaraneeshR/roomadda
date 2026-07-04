import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { erpService } from "./erp.service.js";
import {
  bookingIdParamSchema,
  bulkMarkCommissionReceivedSchema,
  erpCommissionQuerySchema,
  markCommissionReceivedSchema,
} from "./erp.schema.js";

/**
 * ERP finance surface (§15). ADMIN-only for now; a scoped AGENT view comes later
 * (§15.4). Every state change writes an AuditLog (handled in the service). All
 * money is integer paise and every figure comes from the one money engine
 * (erp.engine.ts) so no two ERP screens can disagree.
 */
export const erpRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.requireRole("ADMIN"));

  // ---- Commission ledger (received vs pending), filterable by FY/quarter/month/property/agent ----
  app.get("/erp/commission", async (request) =>
    erpService.commissionLedger(erpCommissionQuerySchema.parse(request.query)),
  );

  // ---- Mark a single booking's commission received (audited) ----
  app.post("/erp/commission/:bookingId/received", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    const body = markCommissionReceivedSchema.parse(request.body ?? {});
    return { entry: await erpService.markReceived(admin, bookingId, body, request.ip) };
  });

  // ---- Bulk mark commission received (audited) ----
  app.post("/erp/commission/received", async (request) => {
    const admin = getAuthUser(request);
    const { bookingIds } = bulkMarkCommissionReceivedSchema.parse(request.body);
    return erpService.markReceivedBulk(admin, bookingIds, request.ip);
  });
};
