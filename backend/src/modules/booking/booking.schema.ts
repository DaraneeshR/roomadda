/**
 * Booking-module request schemas. Definitions live in `@roomadda/shared`
 * (single source of truth, see /CLAUDE.md); this module only re-exports them
 * under the names the route/service use.
 */
export {
  listBookingsQuerySchema,
  createBookingSchema,
  createPaymentSchema,
  uuidParamSchema as bookingIdParamSchema,
  uuidParamSchema as cashCollectionParamSchema,
} from "@roomadda/shared";

export type { ListBookingsQuery, CreateBookingInput, CreatePaymentBody } from "@roomadda/shared";
