/**
 * Badge-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); re-exported under the route's names.
 */
export {
  grantBadgeSchema,
  suspendBadgeSchema,
  listingBadgeParamSchema,
  uuidParamSchema as listingIdParamSchema,
} from "@roomadda/shared";

export type { GrantBadgeInput, SuspendBadgeInput } from "@roomadda/shared";
