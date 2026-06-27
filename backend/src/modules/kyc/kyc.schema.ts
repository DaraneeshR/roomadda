/**
 * KYC request schemas. Definitions live in `@roomadda/shared` (single source of
 * truth, see /CLAUDE.md); this module re-exports them under local names.
 */
export {
  kycUploadUrlSchema,
  kycSubmitSchema,
  kycMimeSchema,
  kycSlotSchema,
  kycSupportingDocTypeSchema,
} from "@roomadda/shared";

export type {
  KycUploadUrlInput,
  KycSubmitInput,
  KycMime,
  KycSlot,
  KycSupportingDocType,
} from "@roomadda/shared";
