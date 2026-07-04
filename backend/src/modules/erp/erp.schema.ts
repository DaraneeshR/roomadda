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
} from "@roomadda/shared";
