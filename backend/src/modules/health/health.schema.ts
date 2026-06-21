/**
 * Health-module response schemas. Definitions live in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md); this module only re-exports them
 * under the names the route uses.
 */
export { livenessResponseSchema, readinessResponseSchema } from "@roomadda/shared";

export type { LivenessResponse, ReadinessResponse } from "@roomadda/shared";
