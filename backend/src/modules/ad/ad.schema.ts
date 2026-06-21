/**
 * Ad-module request schemas. Definitions live in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md); this module only re-exports them
 * under the names the route/service use.
 */
export {
  slotTypeParamSchema,
  putPricingSchema,
  createAdSchema,
  featuredQuerySchema,
  pendingAdsQuerySchema,
  // Generic primitives reused here under ad-specific names.
  uuidParamSchema as adIdParamSchema,
  reasonBodySchema as rejectAdSchema,
} from "@roomadda/shared";

export type { PutPricingInput, CreateAdInput } from "@roomadda/shared";
