import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { erpService } from "./erp.service.js";
import { erpBookingsService } from "./erp.bookings.service.js";
import { erpApprovalsService } from "./erp.approvals.service.js";
import { erpInvoicesService } from "./erp.invoices.service.js";
import { erpFinanceService } from "./erp.finance.service.js";
import { erpAgentsService } from "./erp.agents.service.js";
import { toCsv, toExcelXml } from "./erp.export.js";
import {
  bookingApprovalsQuerySchema,
  bookingIdParamSchema,
  bookingsLedgerExportQuerySchema,
  bookingsLedgerQuerySchema,
  bulkApproveBookingsSchema,
  bulkMarkCommissionReceivedSchema,
  bulkSendInvoicesSchema,
  createHistoricalBookingSchema,
  erpCommissionQuerySchema,
  erpFinanceFilterSchema,
  invoiceListQuerySchema,
  invoiceTypeQuerySchema,
  markCommissionReceivedSchema,
  reassignBookingSchema,
  rejectBookingSchema,
  updateBookingSchema,
  updateInvoiceSchema,
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

  // ---- ERP-4 Dashboard (§15.3): headline numbers + charts + top-agents, one global filter ----
  app.get("/erp/dashboard", async (request) =>
    erpFinanceService.dashboard(erpFinanceFilterSchema.parse(request.query)),
  );

  // ---- ERP-4 Money Manager (§15.3): month-by-month + running balance + customer drill-down ----
  app.get("/erp/money-manager", async (request) =>
    erpFinanceService.moneyManager(erpFinanceFilterSchema.parse(request.query)),
  );

  // ---- ERP-4 Agents (§15.3): per-agent scorecards + commission leaderboard ----
  app.get("/erp/agents", async (request) =>
    erpAgentsService.overview(erpFinanceFilterSchema.parse(request.query)),
  );

  // ---- Reassign a booking's agent attribution → commission/leaderboard recalc (audited) ----
  app.post("/erp/agents/bookings/:bookingId/reassign", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    const { agentId } = reassignBookingSchema.parse(request.body);
    return { result: await erpAgentsService.reassign(admin, bookingId, agentId, request.ip) };
  });

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

  // ---- Invoice Center (§15.6/§15.7): two invoices from one booking, engine-priced ----

  // List: recipient name + number, total, balance, sent status (per type).
  app.get("/erp/invoices", async (request) =>
    erpInvoicesService.list(invoiceListQuerySchema.parse(request.query)),
  );

  // Bulk-send invoices of one type (static path — declared before :bookingId).
  app.post("/erp/invoices/send", async (request) => {
    const admin = getAuthUser(request);
    const { type, bookingIds } = bulkSendInvoicesSchema.parse(request.body);
    return erpInvoicesService.sendBulk(admin, type, bookingIds, request.ip);
  });

  // Review one invoice: line items + total / amount-paid / balance (engine-sourced).
  app.get("/erp/invoices/:bookingId", async (request) => {
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    const { type } = invoiceTypeQuerySchema.parse(request.query);
    return { invoice: await erpInvoicesService.review(bookingId, type) };
  });

  // Generate the invoice PDF (reuses the receipt-PDF approach).
  app.get("/erp/invoices/:bookingId/pdf", async (request, reply) => {
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    const { type } = invoiceTypeQuerySchema.parse(request.query);
    const pdf = await erpInvoicesService.pdf(bookingId, type);
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="roomadda-invoice-${type.toLowerCase()}-${bookingId}.pdf"`)
      .send(Buffer.from(pdf));
  });

  // Edit a CUSTOMER invoice's line item / amount-paid; balance recomputes live (audited).
  app.patch("/erp/invoices/:bookingId", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    const { type } = invoiceTypeQuerySchema.parse(request.query);
    const body = updateInvoiceSchema.parse(request.body);
    return { invoice: await erpInvoicesService.update(admin, bookingId, type, body, request.ip) };
  });

  // Send one invoice (generate PDF + deliver over WhatsApp; audited).
  app.post("/erp/invoices/:bookingId/send", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    const { type } = invoiceTypeQuerySchema.parse(request.query);
    return { invoice: await erpInvoicesService.send(admin, bookingId, type, true, request.ip) };
  });

  // Mark sent WITHOUT resending (existing customers); audited.
  app.post("/erp/invoices/:bookingId/mark-sent", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    const { type } = invoiceTypeQuerySchema.parse(request.query);
    return { invoice: await erpInvoicesService.send(admin, bookingId, type, false, request.ip) };
  });

  // "Comm": generate + send the COMMISSION invoice PDF to the PG owner (pgowner campaign).
  app.post("/erp/invoices/:bookingId/comm", async (request) => {
    const admin = getAuthUser(request);
    const { bookingId } = bookingIdParamSchema.parse(request.params);
    return { invoice: await erpInvoicesService.send(admin, bookingId, "COMMISSION", true, request.ip) };
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
