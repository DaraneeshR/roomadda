import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { erpService } from "./erp.service.js";
import { erpBookingsService } from "./erp.bookings.service.js";
import { erpApprovalsService } from "./erp.approvals.service.js";
import { toCsv, toExcelXml } from "./erp.export.js";
import {
  bookingApprovalsQuerySchema,
  bookingIdParamSchema,
  bookingsLedgerExportQuerySchema,
  bookingsLedgerQuerySchema,
  bulkApproveBookingsSchema,
  bulkMarkCommissionReceivedSchema,
  createHistoricalBookingSchema,
  erpCommissionQuerySchema,
  markCommissionReceivedSchema,
  rejectBookingSchema,
  updateBookingSchema,
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

  // ---- Bookings ledger (§15.3): searchable/sortable table of every booking ----
  app.get("/erp/bookings", async (request) =>
    erpBookingsService.ledger(bookingsLedgerQuerySchema.parse(request.query)),
  );

  // ---- Export the ledger to CSV or Excel (static path — declared before :bookingId) ----
  app.get("/erp/bookings/export", async (request, reply) => {
    const query = bookingsLedgerExportQuerySchema.parse(request.query);
    const rows = await erpBookingsService.exportRows(query);
    const stamp = new Date().toISOString().slice(0, 10);
    if (query.format === "csv") {
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="roomadda-bookings-${stamp}.csv"`)
        .send(toCsv(rows));
    }
    return reply
      .header("Content-Type", "application/vnd.ms-excel; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="roomadda-bookings-${stamp}.xls"`)
      .send(toExcelXml(rows));
  });

  // ---- Add a historical booking assigned to an agent (audited) ----
  app.post("/erp/bookings", async (request, reply) => {
    const admin = getAuthUser(request);
    const body = createHistoricalBookingSchema.parse(request.body);
    const entry = await erpBookingsService.addHistorical(admin, body, request.ip);
    return reply.status(201).send({ entry });
  });

  // ---- Booking / KYC detail (§15.3): customer + invoice + net commission + docs ----
  app.get("/erp/bookings/:bookingId", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    return erpBookingsService.detail(admin, bookingId, request.ip);
  });

  // ---- Edit a booking (safe fields only, audited) ----
  app.patch("/erp/bookings/:bookingId", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    const body = updateBookingSchema.parse(request.body);
    return { entry: await erpBookingsService.update(admin, bookingId, body, request.ip) };
  });

  // ---- Delete a money-untouched booking (audited) ----
  app.delete("/erp/bookings/:bookingId", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    return erpBookingsService.remove(admin, bookingId, request.ip);
  });

  // ---- Approvals queue (§15.3): pending bookings awaiting a decision ----
  app.get("/erp/approvals", async (request) =>
    erpApprovalsService.queue(bookingApprovalsQuerySchema.parse(request.query)),
  );

  // ---- Bulk approve (static path — declared before :bookingId) ----
  app.post("/erp/approvals/approve", async (request) => {
    const admin = getAuthUser(request);
    const { bookingIds } = bulkApproveBookingsSchema.parse(request.body);
    return erpApprovalsService.bulkApprove(admin, bookingIds, request.ip);
  });

  // ---- Approve one pending booking (audited) ----
  app.post("/erp/approvals/:bookingId/approve", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    return { decision: await erpApprovalsService.approve(admin, bookingId, request.ip) };
  });

  // ---- Reject one pending booking with a reason (audited) ----
  app.post("/erp/approvals/:bookingId/reject", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    const { reason } = rejectBookingSchema.parse(request.body);
    return { decision: await erpApprovalsService.reject(admin, bookingId, reason, request.ip) };
  });
};
