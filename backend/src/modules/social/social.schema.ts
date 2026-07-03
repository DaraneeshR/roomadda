/**
 * Social-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); re-exported here under the route's names.
 */
export {
  viewingHeartbeatSchema,
  uuidParamSchema as listingIdParamSchema,
} from "@roomadda/shared";

export type { ViewingHeartbeatInput } from "@roomadda/shared";
