/**
 * Roomie-module request schema. The definition (message bounding + control-char
 * stripping) lives in `@roomadda/shared` (single source of truth, see
 * /CLAUDE.md); this module only re-exports it under the names the route uses.
 */
export { roomieRequestSchema, MAX_MESSAGE_CHARS } from "@roomadda/shared";

export type { RoomieRequest } from "@roomadda/shared";
