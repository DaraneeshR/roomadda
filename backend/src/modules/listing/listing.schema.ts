/**
 * Listing-module request schemas. Definitions live in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md); this module only re-exports them
 * under the names the route/service use.
 */
export {
  createListingSchema,
  updateListingSchema,
  createRoomSchema,
  createBedSchema,
  createPhotoSchema,
  listingPhotoUploadUrlSchema,
  roomParamSchema,
  listFiltersSchema,
  nearbyQuerySchema,
  uuidParamSchema as listingIdParamSchema,
} from "@roomadda/shared";

export type {
  CreateListingInput,
  UpdateListingInput,
  CreateRoomInput,
  CreateBedInput,
  CreatePhotoInput,
  ListingPhotoUploadUrlInput,
  ListFilters,
  NearbyQuery,
} from "@roomadda/shared";
