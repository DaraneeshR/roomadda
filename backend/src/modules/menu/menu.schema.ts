/**
 * Meal-menu request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); this module only re-exports them under the
 * names the route/service use.
 */
export {
  menuQuerySchema,
  upsertMealMenuSchema,
  uuidParamSchema as listingIdParamSchema,
} from "@roomadda/shared";

export type { MenuQuery, UpsertMealMenuInput } from "@roomadda/shared";
