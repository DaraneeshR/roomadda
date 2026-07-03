/**
 * Review-module request schemas. Definitions live in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md); re-exported here under the names the
 * route/service use. `uuidParamSchema` backs both `:id` params (listing + review).
 */
export {
  createReviewSchema,
  hostReviewResponseSchema,
  listReviewsQuerySchema,
  uuidParamSchema as listingIdParamSchema,
  uuidParamSchema as reviewIdParamSchema,
} from "@roomadda/shared";

export type { CreateReviewInput, HostReviewResponseInput, ListReviewsQuery } from "@roomadda/shared";
