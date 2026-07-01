/**
 * Safety request schemas. Definitions live in `@roomadda/shared` (single source
 * of truth, see /CLAUDE.md); this module only re-exports them.
 */
export {
  createTrustedContactSchema,
  sosSchema,
  uuidParamSchema as trustedContactIdParamSchema,
} from "@roomadda/shared";

export type { CreateTrustedContactInput, SosInput } from "@roomadda/shared";
