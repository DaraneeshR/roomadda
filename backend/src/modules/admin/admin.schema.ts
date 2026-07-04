/**
 * Admin-module request schemas. Definitions live in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md); this module only re-exports them
 * under the names the route/service use.
 */
export {
  kycQuerySchema,
  listingReviewQuerySchema,
  cashQuerySchema,
  bookingSearchSchema,
  paymentSearchSchema,
  adminServiceRequestsQuerySchema,
  adminInspectionsQuerySchema,
  createAgentSchema,
  cashQuerySchema as chatReportsQuerySchema,
  uuidParamSchema as idParamSchema,
  reasonBodySchema as rejectSchema,
  // Service-request oversight
  adminResolveServiceRequestSchema,
  adminContactHostSchema,
  flagHostSchema,
  // Host & agent management
  adminHostsQuerySchema,
  adminAgentsQuerySchema,
  moderateUserSchema,
  updateAgentTerritorySchema,
  assignVisitSchema,
  reasonBodySchema as takedownSchema,
} from "@roomadda/shared";
