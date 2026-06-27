/**
 * Auth-module request schemas. Definitions live in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md); this module only re-exports them
 * under the names the route/service use.
 */
export {
  otpRequestSchema,
  otpVerifySchema,
  refreshSchema,
  logoutSchema,
  roleChangeBodySchema,
  uuidParamSchema as userIdParamSchema,
} from "@roomadda/shared";

export type {
  AppAudience,
  ClientType,
  OtpRequestInput,
  OtpVerifyInput,
  RefreshInput,
} from "@roomadda/shared";
