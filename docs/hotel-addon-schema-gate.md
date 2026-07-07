# Hotel B2C add-on — data-model foundation (schema gate)

**Status:** schema + migration + visibility invariant + nightly overbooking guard
landed and proven. **No booking flow yet** — this is a schema gate only.

**Scope built:** `PropertyType` + `ListingVisibility` on the existing listing;
`HotelRoomCategory` → `HotelRoom` (units) → `HotelReservation` (nightly, date-range);
a DB-level overbooking guard; and a server-side visibility filter wired into the B2C
listing reads. Everything reuses the existing money helpers, audit, approval queue,
and the `migrate diff --from-migrations` + `migrate deploy` workflow (never `migrate dev`).

---

## Schema-affecting OPEN QUESTIONS — signed off, but flag if these change

The PRD has **no** hotel/corporate schema spec — "Corporate tie-up portal" is a **P3
"separate roadmap"** item and the only "hotel" mention is a Google-Maps analogy. So the
three money/pricing-structure decisions below were genuinely open. They were put to the
product owner and **signed off** on the recommended (minimal-safe) option. If any of
these assumptions is wrong, the model changes — re-open before building the booking flow.

| # | Open question | **Signed-off decision** | If it changes… |
|---|---------------|-------------------------|----------------|
| 1 | **Nightly pricing / rate-plan structure** | **Single base `perNightPaise` per category.** Weekend / seasonal / length-of-stay rate plans are DEFERRED to a future `HotelRatePlan` table. | Add `HotelRatePlan(categoryId, validFrom, validTo, perNightPaise)`; the reservation already snapshots `perNightPaise` so historical bookings are safe. |
| 2 | **Corporate vs walk-in/B2C inventory isolation** | **Hard reserved block off `totalRooms`.** `corporateReservedRooms` is a physical carve-out: B2C-bookable = `totalRooms − corporateReservedRooms`. Materialised as `HotelRoom` units tagged `channel B2C \| CORPORATE`. | Switch to a `channel`-per-hold model or per-channel capacity columns; the guard (per-unit) is unaffected. |
| 3 | **Billing terms (hotel B2C)** | **Mirror PG: token/hold now, settled ONLY by the signature-verified Razorpay webhook** (CLAUDE.md money rule #2). No billing columns added in this gate. | Corporate net-30 / post-pay would add `creditDays` / `billingEntity` on the corporate side. |

---

## The nightly overbooking guard — approach, FLAGGED FOR REVIEW

This is the critical correctness item: the hotel analog of the bed double-booking guard.
A hotel category has capacity > 1, so a plain partial-unique index (capacity-1-per-key)
does not express it. The design:

1. **Materialise units.** Each category is provisioned into `totalRooms` concrete
   `HotelRoom` rows (the nightly analog of `Bed`; capacity 1 each), physically split by
   `channel` into the B2C pool and the ring-fenced corporate allotment.
2. **Per-unit daterange exclusion constraint** on `hotel_reservations`
   (`prisma/sql/03_hotel_guard.sql`, applied by `pnpm db:sql` after `migrate deploy` —
   a daterange-overlap exclusion cannot be expressed in `schema.prisma`):

   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   ALTER TABLE hotel_reservations ADD CONSTRAINT no_overlapping_hotel_reservation
     EXCLUDE USING gist (
       "hotelRoomId" WITH =,
       daterange("checkIn", "checkOut", '[)') WITH &&
     ) WHERE (status IN ('HELD', 'CONFIRMED'));
   ```

**Why this makes overbooking impossible at the DB level (not just in app code):**
- The **FK** `hotel_reservations.hotelRoomId → hotel_rooms` bounds *total* capacity — you
  cannot reserve a room that does not exist.
- The **exclusion constraint** bounds *per-room* overlap — two LIVE reservations can never
  cover an overlapping night on the same room.
- Together: an overlapping-date-range double-book is rejected by Postgres even when all app
  code is bypassed (proven in `hotel.integration.test.ts`).

**Semantics:** `daterange(..,'[)')` is **half-open**, so same-day turnover
(prev `checkOut` == next `checkIn`) is NOT a conflict — the correct hotel behaviour.
`WHERE status IN ('HELD','CONFIRMED')` means only LIVE holds participate; a CANCELLED /
EXPIRED reservation frees the room. When the booking flow lands it will ALSO take a row
lock (`SELECT … FOR UPDATE`) on allocation, exactly like the bed guard's belt-and-braces.

**Points reviewers should sign off:**
- Materialising units vs a slot-index approach (units chosen for a true FK capacity bound
  and clean channel isolation — matches the "bed-level inventory" domain rule).
- The unit-count invariant (B2C units = `totalRooms − corporateReservedRooms`,
  corporate units = `corporateReservedRooms`) is a **provisioning** responsibility — it is
  documented but NOT yet enforced by a service (no hotel CRUD in this gate).

---

## Visibility enforcement (server-side, like masking)

`modules/listing/visibility.ts` is the single source: `visibleVisibilities(audience)` →
B2C sees `USER_ONLY + BOTH`; CORPORATE sees `CORPORATE_ONLY + BOTH`. Wired into the B2C
listing reads — `listPublished` (browse), `nearby` (raw SQL), and the detail route
(`GET /listings/:id` 404s a CORPORATE_ONLY listing for non-privileged viewers). A
CORPORATE_ONLY property therefore never appears in a B2C response; owner / admin / agent
still see it. Existing PG listings default to `USER_ONLY`, so this is a no-op for them.

## Approval-queue reuse

Hotel listings are `PgListing` rows, so they already flow through the existing admin
approval queue and go-live gate unchanged. A **visibility (channel) change re-queues for
approval** — `visibility` was added to `edit-classify.ts` `REQUEUE_FIELDS` alongside the
address fields, so a re-tag is admin-vetted through the same queue as a PG address edit.
`propertyType` is set at creation only (no update path) — flag if hosts must be able to
convert a property kind later.

## Byte-for-byte PG safety

- New columns are `NOT NULL DEFAULT` (`PG` / `USER_ONLY`) — existing rows are untouched.
- The public/private serializer DTOs are unchanged — `propertyType` / `visibility` are NOT
  added to the listing DTO, so serialized output is identical (asserted in the test).
- Proven: all 232 unit tests pass; the integration suite's PG paths pass unchanged.

## Follow-ups (out of this gate)

- Hotel category/unit CRUD + the provisioning invariant enforcement.
- The nightly booking/hold service (row-lock allocation) + payment/webhook wiring.
- Audit secondary B2C surfaces if corporate listings ever reach them — e.g. admin-curated
  homepage features (`cms.getHomepage`) and area-insight aggregates currently do not apply
  the visibility filter (today they can't leak one — no corporate listings exist and the
  homepage is an explicit admin pin list).
- `HotelRatePlan` (seasonal/weekend/LOS) if decision #1 changes.
