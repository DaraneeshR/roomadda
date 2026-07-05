/**
 * ERP-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); this module only re-exports them under the
 * names the route/service use.
 */
export {
  erpCommissionQuerySchema,
  bookingIdParamSchema,
  markCommissionReceivedSchema,
  bulkMarkCommissionReceivedSchema,
  // ERP-2 — bookings ledger, approvals, booking/KYC detail (§15.3).
  bookingsLedgerQuerySchema,
  bookingsLedgerExportQuerySchema,
  bookingApprovalsQuerySchema,
  createHistoricalBookingSchema,
  updateBookingSchema,
  rejectBookingSchema,
  bulkApproveBookingsSchema,
  // ERP-3 — Invoice Center (§15.6/§15.7).
  invoiceListQuerySchema,
  invoiceTypeQuerySchema,
  updateInvoiceSchema,
  bulkSendInvoicesSchema,
  // ERP-4 — dashboard, money manager, agents (§15.3).
  erpFinanceFilterSchema,
  reassignBookingSchema,
  // ERP-5 — CA & compliance and settings/users (§15.3/§15.7).
  caPackQuerySchema,
  erpReportParamSchema,
  erpReportQuerySchema,
  addTeamMemberSchema,
  updateOrgSettingsSchema,
} from "@roomadda/shared";
