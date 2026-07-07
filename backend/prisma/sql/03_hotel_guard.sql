-- 03_hotel_guard.sql
-- Nightly hotel overbooking guard (the hotel analog of 02_booking_guard.sql's
-- bed guard). Invariant: a single hotel room can have at most ONE *live*
-- reservation on any given night.
-- Live = HELD | CONFIRMED.
--
-- Capacity per category is > 1, so a partial UNIQUE index (which enforces
-- capacity 1 per key) is not enough on its own. Instead each category is
-- materialised into concrete HotelRoom units (capacity 1 each, like Beds), and
-- this EXCLUDE constraint forbids two live reservations on the SAME room whose
-- date ranges OVERLAP. The FK hotel_reservations.hotelRoomId -> hotel_rooms
-- bounds total capacity (you cannot reserve a room that does not exist); this
-- constraint bounds per-room overlap. Together an overlapping-date-range
-- double-book is impossible at the DB level, not just in app code. The booking
-- service will ALSO take a row lock (SELECT ... FOR UPDATE) so concurrent holds
-- serialize cleanly — same belt-and-braces pattern as the bed guard.
--
-- daterange(checkIn, checkOut, '[)') is HALF-OPEN: it covers nights
-- [checkIn, checkOut). So same-day turnover — one guest checks out on the day
-- the next checks in (prev.checkOut == next.checkIn) — does NOT overlap and is
-- allowed, which is the correct hotel semantic.
--
-- A daterange-overlap exclusion cannot be expressed in schema.prisma, so it
-- lives here (applied by `pnpm db:sql` after `prisma migrate deploy`).
-- Drop+recreate so the live-status set / definition stays correct. Idempotent.

-- GiST equality on the uuid hotelRoomId needs the btree_gist operator classes.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE hotel_reservations
  DROP CONSTRAINT IF EXISTS no_overlapping_hotel_reservation;

ALTER TABLE hotel_reservations
  ADD CONSTRAINT no_overlapping_hotel_reservation
  EXCLUDE USING gist (
    "hotelRoomId" WITH =,
    daterange("checkIn", "checkOut", '[)') WITH &&
  )
  WHERE (status IN ('HELD', 'CONFIRMED'));
