/**
 * Hotel-module request schemas. Definitions live in `@roomadda/shared` (single
 * source of truth, see /CLAUDE.md); this module only re-exports them under the
 * names the route/service use.
 */
export {
  hotelSearchQuerySchema,
  createHotelReservationSchema,
  listHotelReservationsQuerySchema,
  cancelBookingSchema as cancelHotelReservationSchema,
  uuidParamSchema as reservationIdParamSchema,
} from "@roomadda/shared";

export type {
  HotelSearchQuery,
  CreateHotelReservationInput,
  ListHotelReservationsQuery,
} from "@roomadda/shared";
