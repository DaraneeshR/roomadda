/**
 * Corporate-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, /CLAUDE.md); this module only re-exports them under the names the
 * route/service use.
 */
export {
  createCompanySchema,
  assignAccountManagerSchema,
  createEmployeeSchema,
  createEnquirySchema,
  buildQuotationSchema,
  addRevisionSchema,
  respondQuotationSchema,
  allocateEmployeeSchema,
  settleInvoiceOfflineSchema,
  corporateListQuerySchema,
  corporatePipelineQuerySchema,
  uuidParamSchema,
} from "@roomadda/shared";

export type {
  CreateCompanyInput,
  AssignAccountManagerInput,
  CreateEmployeeInput,
  CreateEnquiryInput,
  BuildQuotationInput,
  AddRevisionInput,
  RespondQuotationInput,
  AllocateEmployeeInput,
  SettleInvoiceOfflineInput,
  CorporateListQuery,
  CorporatePipelineQuery,
} from "@roomadda/shared";
