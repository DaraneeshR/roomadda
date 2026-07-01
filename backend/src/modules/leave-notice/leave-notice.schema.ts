/**
 * Leave-notice request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); this module only re-exports them.
 */
export {
  createLeaveNoticeSchema,
  uuidParamSchema as leaveNoticeIdParamSchema,
} from "@roomadda/shared";

export type { CreateLeaveNoticeInput } from "@roomadda/shared";
