/**
 * Rent-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); this module only re-exports them under the
 * names the route uses. The pay endpoint takes NO body — the server always
 * orders the full invoice amount, so a partial payment cannot be requested.
 */
export { listRentQuerySchema, uuidParamSchema as invoiceIdParamSchema } from "@roomadda/shared";

export type { ListRentQuery } from "@roomadda/shared";
