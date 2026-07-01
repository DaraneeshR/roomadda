/**
 * Service-request request schemas. Definitions live in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md); this module only re-exports them
 * under the names the route/service use.
 */
export {
  createServiceRequestSchema,
  serviceRequestCommentInputSchema,
  serviceRequestRatingSchema,
  serviceRequestPhotoUrlSchema,
  listServiceRequestsQuerySchema,
  adminServiceRequestsQuerySchema,
  uuidParamSchema as serviceRequestIdParamSchema,
} from "@roomadda/shared";

export type {
  CreateServiceRequestInput,
  ListServiceRequestsQuery,
  AdminServiceRequestsQuery,
} from "@roomadda/shared";
