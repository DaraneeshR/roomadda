/**
 * Agent-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); this module only re-exports them under the
 * names the routes/services use.
 */
export {
  visitIdParamSchema,
  agentVisitsQuerySchema,
  agentCheckInSchema,
  inspectionDraftSchema,
  inspectionPhotoUrlSchema,
  addInspectionPhotoSchema,
  agentBookingSchema,
} from "@roomadda/shared";

export type {
  AgentVisitsQuery,
  AgentCheckInInput,
  InspectionDraftInput,
  InspectionPhotoUrlInput,
  AddInspectionPhotoInput,
  AgentBookingInput,
} from "@roomadda/shared";
