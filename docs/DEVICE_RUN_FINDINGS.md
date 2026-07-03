# Device-run findings — Tenant app (first run)

**Triage only. No fixes in this pass.** Each finding is classified:

- **COSMETIC** — layout / spacing / copy / loading-state. Safe to batch later.
- **STRUCTURAL** — data-shape mismatch, masking shown too early/late, poller not
  updating UI, auth/session, or anything that would repeat in other surfaces
  (website/webadmin) if the same assumption is copied. Each has **file + likely cause**.

Structural items are listed first.

---

## Run context (what this triage is grounded in)

- **Backend:** local dev server (`bgiqzf048`), PostGIS + Redis up, demo seed loaded.
- **Login:** TENANT `+919000000003` (KYC-verified seed account). Session was already
  in secure storage from a prior run — **no OTP request/verify appears in this run's
  trace**, so the login screen was not exercised this session.
- **Directly observed:** one screenshot — the Search/home screen (see COSMETIC-1).
- **Evidenced by backend request log (this run):**

  | Request | Count | Result |
  |---|---|---|
  | `GET /v1/listings?area=Koramangala` | 4 | 200 |
  | `GET /v1/listings?area=HSR` | 1 | 200 |
  | `GET /v1/listings/…0001` | 1 | 200 |
  | `GET /v1/listings/…0002` | 2 | 200 (2nd after refresh) |
  | `GET /v1/kyc/me` | 6 | 200 |
  | `POST /v1/kyc/upload-url` | 3 | 201 |
  | `POST /v1/auth/refresh` | 1 | 200 |
  | (access-token expiry) | — | 2× 401 + "Invalid or expired token" |

- **Flow reached:** search → results → listing detail → KYC upload. The **booking
  sheet / payment** step was NOT reached on this run, so STRUCTURAL-1 below is a
  code-path finding on the immediate next step, not a directly-observed failure.
- **No 500s and no crashes** occurred during the run.

---

## STRUCTURAL

### S1 — Booking "Pay now (token)" is computed client-side and diverges from the server token  ✅ FIXED (was ⚠️ high)

**Resolution:** one token-pricing policy now lives in `@roomadda/shared`
(`effectiveTokenPaise`), called by BOTH `booking.service` (what it charges) and the
listing serializer (`toRoom`) which now emits `tokenAmountPaise` per room. The
tenant model parses it (`ListingRoom.tokenAmount`, nullable), the booking sheet
displays THAT (`_token`/`deposit||rent` deleted), and disables the CTA if it is ever
absent (never a guess). Verified live: the seeded Koramangala listing returns
`tokenAmountPaise: 200000` (₹2,000), not the ₹12,000 deposit. Tests: serializer token
cases (backend), `listing_masking_test` token cases (mobile).


- **Files:**
  - `mobile/tenant/lib/features/booking/presentation/booking_sheet.dart:47`
    (`_token(room) => room.deposit.value > 0 ? room.deposit : room.monthlyRent`),
    surfaced in `_Summary` (`booking_sheet.dart:154`, `:221` — "Pay now (token)").
  - Contract gap: `backend/src/modules/listing/serializer.ts` (`commonFields`) and the
    mobile model `mobile/tenant/lib/features/discovery/domain/listing.dart`
    (`PublicListing`) — neither exposes `tokenAmountPaise`.
- **Likely cause (one line):** the token is server-owned
  (`booking.service.ts:109`: `listing.tokenAmountPaise ?? (deposit>0 ? deposit : rent)`),
  but the masked listing DTO never sends `tokenAmountPaise`, so the pre-hold sheet
  *guesses* `deposit || rent` — which is wrong whenever a host sets an explicit token.
- **Live on the seeded data:** seed sets every listing's `tokenAmountPaise = ₹2,000`
  while deposit = one month's rent (₹9,500 / ₹12,000 / ₹15,000). The sheet would show
  **"Pay now (token): ₹12,000"**; the payment screen (`booking_payment_screen.dart:74/118`,
  which uses the server-authoritative `booking.tokenAmount`) charges **₹2,000**.
- **Why structural:** violates money rule #1 (no ad-hoc money arithmetic in a component;
  amounts are server-authoritative). The same "token = deposit" assumption will misprice
  the booking summary on website/webadmin if copied. Also a trust problem — the summary
  overstates the charge ~6×.

### S2 — Confirmed-tenant address reveal is silently dropped by the discovery model/detail screen  ✅ FIXED (was low)

**Resolution:** `PublicListing` now carries optional `actualName` / `fullAddress` /
`exactLocation`, parsed ONLY when `masked == false` (a leaked masked payload still
drops them — client-side defence-in-depth). The detail screen renders a new
`_RevealedLocation` (real name + full address + exact pin) when `!listing.masked`,
else the masked map. No backend change: the server already returned the private shape
to confirmed tenants. Tests: `listing_masking_test` reveal + leak cases (mobile).


- **Files:**
  - `mobile/tenant/lib/features/discovery/domain/listing.dart` — `PublicListing` has no
    `actualName` / `fullAddress` / exact-geo fields.
  - `mobile/tenant/lib/features/discovery/presentation/listing_detail_screen.dart:175`
    (`_MaskedMap`, rendered unconditionally) and `:64`.
- **Likely cause (one line):** `GET /v1/listings/:id` returns the **private** shape
  (`masked:false` + real name/address/geo) to a confirmed tenant
  (`listing.route.ts:189-198`), but the discovery model only parses the masked shape, so
  those fields are discarded and the detail screen keeps showing "exact address shown
  after your booking is confirmed" even after it is.
- **Scope / why it's low:** NOT triggered this run (tenant had no confirmed booking). The
  reveal *does* work in the booking flow via `BookingListing` (`booking_payment_screen.dart:233-251`),
  so the gap only shows if a confirmed tenant re-opens the PG through discovery.
- **Why structural (not cosmetic):** it's a data-shape/contract mismatch on the masking
  boundary — the model can't represent what the server authorized — which is exactly the
  kind of masking assumption that repeats across surfaces.

---

## COSMETIC

### C1 — Home/Search first-run empty state is ~70% blank  (OBSERVED)

- **File:** `mobile/tenant/lib/features/discovery/presentation/home_screen.dart:90-94`
  (`recentSearches` is empty on a fresh session → `_RecentSearches` renders
  `SizedBox.shrink()` at `:171`).
- **What was seen:** below the search box the screen is empty — no nearby/popular areas,
  no recent searches, no illustration or guidance. Search-first is by design, but the
  large blank area reads as unfinished on first launch.
- **Batchable fix direction (later):** a "Popular areas" chip row or a nearby-PG teaser
  under the search box before any typing.

---

## Checked and OK (recorded so they aren't re-triaged)

- **Auth 401 → refresh → retry:** single-flighted (`auth_interceptor.dart:53`,
  `_refreshing ??=`); the mid-session token expiry recovered transparently
  (2× 401 → one `/v1/auth/refresh` → 200 → retry 200). Working as designed.
- **KYC `/me` envelope:** route returns `{ kyc: … }` (`kyc.route.ts:37`); the repo
  unwraps `res.data['kyc']` before `KycView.fromJson` (`kyc_repository.dart:25`). Shapes match.
- **Public listing shape:** `toPublicListing` (serializer) is a superset of what
  `PublicListing.fromJson` reads; `photos`/`rooms`/`amenities` default safely to `[]`,
  `approxLocation` tolerates missing. No mismatch.
- **Payment-truth boundary:** the app never self-confirms — Razorpay success sets
  `submitted`, and CONFIRMED comes only from the poller
  (`booking_payment_screen.dart:94-97`, `_ConfirmationView`). Correct.

## Minor observations (not classified as issues)

- **Access-token TTL — checked, intentional (no change).** Value: **15 minutes**, set as
  `const ACCESS_TTL = "15m"` in `backend/src/lib/tokens.ts:14` (documented in the file
  header as a deliberate "short-lived 15m access token" design, paired with the opaque
  refresh token). The run's early 401 was NOT the TTL misfiring: the session was restored
  from a PRIOR run's storage, so the stored access token was already near its 15-min end
  and expired mid-session; the interceptor refreshed transparently. 15m is a standard,
  deliberate value — left as-is.
- **Coverage gap:** results / listing-detail / KYC screens were exercised in the log but
  not screenshotted this run, so their *visual* cosmetics were not assessed. A second pass
  with screenshots of those screens would complete cosmetic coverage.
