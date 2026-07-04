/**
 * Broadcast-module request schemas. Definitions live in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md); re-exported under local names.
 */
export {
  createBroadcastSchema,
  broadcastsQuerySchema,
  uuidParamSchema as broadcastIdParamSchema,
} from "@roomadda/shared";

export type { CreateBroadcastInput, BroadcastsQuery } from "@roomadda/shared";
