-- 02_booking_guard.sql
-- Bed-level inventory guard (see /CLAUDE.md domain rule #3):
-- a bed may have at most ONE *live* booking.
-- Live = INITIATED | TOKEN_PENDING | CONFIRMED.
--
-- This is the database half of the invariant; the booking service ALSO takes a
-- row lock (SELECT ... FOR UPDATE) so concurrent attempts serialize cleanly.
-- A partial unique index cannot be expressed in schema.prisma, so it lives here.
-- Idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_booking_per_bed
  ON bookings ("bedId")
  WHERE status IN ('INITIATED', 'TOKEN_PENDING', 'CONFIRMED');
