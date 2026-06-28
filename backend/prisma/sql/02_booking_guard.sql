-- 02_booking_guard.sql
-- Bed-level inventory guard (see /CLAUDE.md domain rule #3):
-- a bed may have at most ONE *live* booking.
-- Live = INITIATED | PENDING_APPROVAL | TOKEN_PENDING | CONFIRMED.
--
-- This is the database half of the invariant; the booking service ALSO takes a
-- row lock (SELECT ... FOR UPDATE) so concurrent attempts serialize cleanly.
-- A partial unique index cannot be expressed in schema.prisma, so it lives here.
-- Drop+recreate so the WHERE set stays correct as live statuses evolve. Idempotent.

DROP INDEX IF EXISTS uniq_live_booking_per_bed;
CREATE UNIQUE INDEX uniq_live_booking_per_bed
  ON bookings ("bedId")
  WHERE status IN ('INITIATED', 'PENDING_APPROVAL', 'TOKEN_PENDING', 'CONFIRMED');
