/**
 * Agent-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); this module only re-exports them under the
 * names the routes/services use.
 */
export {
  visitIdParamSchema,
  agentBookingIdParamSchema,
  agentVisitsQuerySchema,
  agentCheckInSchema,
  inspectionDraftSchema,
  inspectionPhotoUrlSchema,
  addInspectionPhotoSchema,
  agentBookingSchema,
  // ERP-6 — scoped agent ERP view (§15.4).
  agentErpBookingsQuerySchema,
  agentErpBookingIdParamSchema,
  agentErpUploadUrlSchema,
  agentSubmitBookingSchema,
} from "@roomadda/shared";

export type {
  AgentVisitsQuery,
  AgentCheckInInput,
  InspectionDraftInput,
  InspectionPhotoUrlInput,
  AddInspectionPhotoInput,
  AgentBookingInput,
  AgentErpBookingsQuery,
  AgentErpUploadUrlInput,
  AgentSubmitBookingInput,
} from "@roomadda/shared";
