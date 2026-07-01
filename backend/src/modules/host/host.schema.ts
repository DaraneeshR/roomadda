/**
 * Host-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); this module only re-exports them under the
 * names the routes/services use.
 */
export {
  uuidParamSchema as listingIdParamSchema,
  roomParamSchema,
  walkInParamSchema,
  mealTemplateParamSchema,
  listingTemplateParamSchema,
  limitSchema,
  updateHostListingSchema,
  updateHostRoomSchema,
  adjustInventorySchema,
  createWalkInSchema,
  walkInQuerySchema,
  rosterQuerySchema,
  hostBookingRequestsQuerySchema,
  hostServiceQuerySchema,
  serviceNoteSchema,
  broadcastSchema,
  createMealTemplateSchema,
  applyMealTemplateSchema,
  upsertMealMenuSchema,
  menuQuerySchema,
  listChatMessagesQuerySchema as pageQuerySchema,
} from "@roomadda/shared";

export type {
  UpdateHostListingInput,
  UpdateHostRoomInput,
  AdjustInventoryInput,
  CreateWalkInInput,
  WalkInQuery,
  RosterQuery,
  HostBookingRequestsQuery,
  HostServiceQuery,
  ServiceNoteInput,
  BroadcastInput,
  CreateMealTemplateInput,
  ApplyMealTemplateInput,
  UpsertMealMenuInput,
} from "@roomadda/shared";
