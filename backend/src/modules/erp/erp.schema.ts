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
} from "@roomadda/shared";
