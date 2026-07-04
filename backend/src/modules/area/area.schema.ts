/**
 * Area-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); this module only re-exports them.
 */
export { areaParamSchema, areaInsightsQuerySchema } from "@roomadda/shared";
export type { AreaParam, AreaInsightsQuery } from "@roomadda/shared";
