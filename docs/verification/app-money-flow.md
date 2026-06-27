# RoomAdda — App Money-Flow Verification Runbook

A **manual** runbook a human follows on a **real device or emulator** against a
**staging** backend. It proves the one invariant that the whole product rests on
(see [CLAUDE.md](../../CLAUDE.md) domain rule #2):

> A booking becomes `CONFIRMED` **only** when a signature-verified Razorpay
> webhook (`payment.captured`) settles the full token amount. The app never
> confirms from its own success screen.

**This flow is "verified" ONLY when every PASS condition below holds against a
real, signed webhook delivered to staging from the Razorpay dashboard, observed
on a device.** A green automated smoke test
([backend/scripts/booking-smoke.ts](../../backend/scripts/booking-smoke.ts)) is
necessary but **not** sufficient — it fabricates the webhook locally. This
runbook requires the *real* Razorpay → staging delivery.

Record the result of every step in the [Sign-off checklist](#6-sign-off-checklist).

---

## 0. The one configuration trap — read this first

The backend swaps real gateways for in-process stubs based on `NODE_ENV`:

| Component | `NODE_ENV=production` | otherwise (`development`/`test`) |
|---|---|---|
| Razorpay client ([backend/src/lib/razorpay.ts](../../backend/src/lib/razorpay.ts)) | **LiveRazorpay** — real `api.razorpay.com` orders | `StubRazorpay` — fake `order_stub_…`, **no real webhook ever fires** |
| OTP SMS ([backend/src/lib/sms.ts](../../backend/src/lib/sms.ts)) | **Msg91SmsSender** — real SMS | `DevSmsSender` — logs `DEV_OTP <phone> <code>`, no SMS |

**Consequence:** to get a *real signed webhook* you MUST run staging with
`NODE_ENV=production`. That same switch routes OTP through MSG91 (real SMS), so
you need a real phone you control plus a working MSG91 template.

> ⚠️ Do **not** be tempted to run staging in `development` to read the OTP from
> the logs — that also stubs Razorpay, so no real order and no real webhook are
> produced, and the drill is meaningless. `NODE_ENV=production` is mandatory.

**"Test mode" vs `NODE_ENV`:** Razorpay test mode is selected purely by the
**keys** (`rzp_test_…`), not by code. So the correct staging config is
`NODE_ENV=production` **with Razorpay test keys**.

**The app does not hold a Razorpay key.** The mobile checkout uses the `keyId`
returned in the order response
([payment.service.ts](../../backend/src/modules/booking/payment.service.ts) →
`env.RAZORPAY_KEY_ID`; consumed in
[booking_payment_screen.dart](../../mobile/lib/features/booking/presentation/booking_payment_screen.dart)).
Setting `RAZORPAY_KEY_ID` (test key) on the **backend** is what puts the test key
in the app. Do not go hunting for a key inside the Flutter project.

---

## 1. Backend on staging

**Goal:** a public HTTPS backend, data stores wired, both raw-SQL files applied,
readiness green.

### 1.1 Environment

Set these (validated at boot by
[backend/src/config/env.ts](../../backend/src/config/env.ts); a missing/invalid
var aborts the process):

```
NODE_ENV=production
HOST=0.0.0.0
PORT=3001                      # or whatever the platform routes 443 → 
DATABASE_URL=postgres://…       # PostGIS-capable Postgres
REDIS_URL=redis://…
JWT_ACCESS_SECRET=…             # ≥ 32 chars
JWT_REFRESH_SECRET=…            # ≥ 32 chars
RAZORPAY_KEY_ID=rzp_test_…      # TEST key
RAZORPAY_KEY_SECRET=…           # TEST secret
RAZORPAY_WEBHOOK_SECRET=…       # must equal the dashboard webhook secret (step 2)
MSG91_AUTH_KEY=…
MSG91_OTP_TEMPLATE_ID=…         # required for the live sender
MSG91_SENDER_ID=…               # if your template needs it
CORS_ORIGINS=…                  # only if a browser origin must call staging
```

### 1.2 Apply migrations + the two raw-SQL files

The geography column / spatial index and the bed-level unique index live outside
Prisma and must be applied after `migrate deploy`:

- [backend/prisma/sql/01_postgis.sql](../../backend/prisma/sql/01_postgis.sql) — `postgis` extension, `pg_listings.location` geography + GIST index.
- [backend/prisma/sql/02_booking_guard.sql](../../backend/prisma/sql/02_booking_guard.sql) — `uniq_live_booking_per_bed` partial unique index.

One command does all of it (defined in
[backend/package.json](../../backend/package.json)):

```bash
pnpm --filter @roomadda/backend db:setup
# = prisma migrate deploy && pnpm db:sql && prisma generate
```

Both SQL files are idempotent (safe to re-run on every deploy).

- **PASS:** `db:setup` exits 0. Spot-check in psql:
  - `SELECT extversion FROM pg_extension WHERE extname='postgis';` returns a version.
  - `SELECT 1 FROM pg_indexes WHERE indexname='uniq_live_booking_per_bed';` returns a row.
  - `SELECT 1 FROM pg_indexes WHERE indexname='idx_pg_listings_location';` returns a row.
- **FAIL:** any of the above is empty, or `db:setup` errors.

### 1.3 Health checks (public URL)

```bash
curl -s https://<staging-host>/health
curl -s -o /dev/null -w '%{http_code}\n' https://<staging-host>/health/ready
curl -s https://<staging-host>/health/ready | jq .
```

Reference: [backend/src/modules/health/health.route.ts](../../backend/src/modules/health/health.route.ts).

- **PASS:**
  - `/health` → `{"status":"ok", ...}` over **HTTPS** (valid cert, no warning).
  - `/health/ready` → HTTP **200** and body
    `{"status":"ready","checks":{"database":"ok","postgis":"<version>","redis":"ok"}}`
    where `postgis` is a real version string (**not** `"down"` or `"missing"`).
- **FAIL:** `/health/ready` returns 503, or any check is `down`/`missing`/`unexpected`.

### 1.4 Seed a bookable listing

You need a `PUBLISHED` listing with an `AVAILABLE` bed and a known **bedId**.

```bash
node --import tsx backend/scripts/seed-public.ts   # prints SEED_LISTING_ID=…
```

([backend/scripts/seed-public.ts](../../backend/scripts/seed-public.ts) plants
deliberately obvious masked markers — `actualName="SECRET-…"`,
`fullAddress="42 SECRETLANE…"` — so a masking leak is easy to spot.)

The public API does **not** expose bed ids, so read the bedId from the DB:

```sql
SELECT b.id, b.label, b.status
FROM beds b JOIN rooms r ON r.id = b."roomId"
WHERE r."listingId" = '<SEED_LISTING_ID>' AND b.status = 'AVAILABLE';
```

- **PASS:** you have a `SEED_LISTING_ID` and one `AVAILABLE` bedId recorded.

### 1.5 Give the test tenant VERIFIED KYC

Placing a hold requires a `VERIFIED` KYC record (just-in-time KYC gate,
[booking.route.ts](../../backend/src/modules/booking/booking.route.ts) →
`requireKyc`). **The mobile app has no in-app KYC submission screen yet**, so set
this up out-of-band for the phone number you will log in with:

- Easiest: insert a `VERIFIED` `KycRecord` for that user directly (as
  [booking-smoke.ts](../../backend/scripts/booking-smoke.ts) line ~52 does), **or**
- Create a `PENDING` record and approve it via `POST /v1/admin/kyc/:id/approve`
  (admin only — [admin.route.ts](../../backend/src/modules/admin/admin.route.ts)).

> The user row is created on first OTP login (§4.1). Log in once first, then
> attach/approve KYC for that user id.

- **PASS:** `GET /v1/me` (as the tenant) shows the user; a `KycRecord` with
  `status='VERIFIED'` exists for that user id.

---

## 2. Razorpay — TEST MODE webhook

Reference: [webhook.route.ts](../../backend/src/modules/booking/webhook.route.ts),
[webhook.service.ts](../../backend/src/modules/booking/webhook.service.ts),
`verifyRazorpaySignature` in [razorpay.ts](../../backend/src/lib/razorpay.ts).

1. In the Razorpay Dashboard, switch to **Test Mode** (top toggle). Confirm your
   API keys are the **`rzp_test_…`** pair used in §1.1.
2. **Settings → Webhooks → Add New Webhook:**
   - **Webhook URL:** `https://<staging-host>/v1/webhooks/razorpay`
   - **Active events:** tick **`payment.captured`** (the only event that triggers
     settlement; everything else is acknowledged and ignored).
   - **Secret:** set a value, and set the backend's `RAZORPAY_WEBHOOK_SECRET` to
     the **exact same** string. The signature is an HMAC-SHA256 of the raw body
     using this secret — a mismatch is rejected with HTTP 400.
3. Note where deliveries are logged: **Settings → Webhooks → (your webhook) →
   the deliveries / recent-events log**. Each delivery shows the event, the
   response code, and a re-deliver option. You will read this in §4.5.

- **PASS:**
  - The webhook is **Active**, URL exactly `…/v1/webhooks/razorpay`, subscribed
    to `payment.captured`.
  - Dashboard secret === backend `RAZORPAY_WEBHOOK_SECRET`.
  - Sanity ping: from the dashboard "test/redeliver" (or curl with a wrong
    signature) → a request with a bad/absent signature yields **HTTP 400**
    (`INVALID_SIGNATURE`); the server does not act on it.
- **FAIL:** secret mismatch (every real delivery would 400), wrong URL, or the
  event not subscribed.

---

## 3. Mobile platform config

### 3.1 Android Firebase / Crashlytics

Crashlytics is wrapped by
[crash_reporter.dart](../../mobile/lib/core/error/crash_reporter.dart): without
platform config it silently disables itself, and collection is **off in debug**
(`setCrashlyticsCollectionEnabled(!kDebugMode)`) — so test it in a **profile or
release** build, not debug.

1. If `mobile/android/` doesn't exist yet, generate the platform folders:
   `cd mobile && flutter create .` (the Android project is not committed).
2. Create the Firebase Android app and place **`google-services.json`** at
   **`mobile/android/app/google-services.json`**.
3. Ensure the Google Services + Crashlytics Gradle plugins are applied (or run
   `flutterfire configure`).

- **PASS (config present):** a **release/profile** build launches and, in the
  Firebase console → Crashlytics, the app registers. Optional active check: trigger
  a non-fatal via `CrashReporter.recordError(...)` and see it appear in the console.
- **PASS (config intentionally absent):** the app still launches normally and
  logs `Uncaught error:` locally instead of crashing — i.e. the missing-config
  guard works. (Acceptable if Crashlytics is out of scope for this pass; note it.)
- **FAIL:** the app crashes on launch because Firebase failed to init.

### 3.2 Razorpay key

No app-side key. Confirm the backend `RAZORPAY_KEY_ID` is the **test** key (§1.1);
the app receives it per-order. (Verify in §4.4 that Razorpay checkout opens in
**Test Mode**.)

### 3.3 API base URL → staging

Resolution order is `--dart-define` → `.env` → default
([env.dart](../../mobile/lib/core/config/env.dart)). Build/run pointed at staging:

```bash
cd mobile
flutter run --release \
  --dart-define=API_BASE_URL=https://<staging-host> \
  --dart-define=APP_ENV=prod
```

- **PASS:** the app's traffic hits `https://<staging-host>` (verify by seeing the
  OTP request land in staging logs, or via a proxy). `APP_ENV=prod` so no dev
  defaults leak in.
- **FAIL:** requests go to `http://10.0.2.2:3001` (the dev default) — the define
  didn't take.

---

## 4. The one true cycle (on the device)

Do this on a real device or emulator running the staging-pointed build from §3.3.

### 4.1 Log in via OTP

1. Enter the test tenant's phone number; request OTP.
2. **OTP delivery in staging:** with `NODE_ENV=production`, the OTP is sent as a
   **real SMS via MSG91** to that number (the dev log-the-code stub is
   non-production only — [sms.ts](../../backend/src/lib/sms.ts)). Use a phone you
   control. **Record the channel: "received as SMS on <number>."**
3. Enter the code; the app stores the session and lands on the tenant home.

- **PASS:** OTP arrives by SMS; verifying it returns a session and the tenant
  shell loads. `GET /v1/me` reflects the logged-in user.
- **FAIL:** no SMS (MSG91 misconfigured) or verify fails.

> If KYC wasn't set up before, attach/approve it now for this user id (§1.5),
> then continue — the hold in §4.3 will 403 (`KYC_REQUIRED`) without it.

### 4.2 Browse → open listing → masking holds pre-booking

The current tenant UI ([tenant_shell.dart](../../mobile/lib/features/tenant/presentation/tenant_shell.dart))
takes a **bedId** to start a booking rather than a full browse gallery, so verify
masking at the **server boundary** (the source of truth — masking is enforced
server-side, never by the client):

```bash
# As the public/unauthenticated caller:
curl -s https://<staging-host>/v1/listings/<SEED_LISTING_ID> | jq .listing
# And as the logged-in tenant (no confirmed booking yet) — same masked result:
curl -s -H "Authorization: Bearer <tenant-access-token>" \
  https://<staging-host>/v1/listings/<SEED_LISTING_ID> | jq .listing
```

- **PASS:** both responses have `"masked": true`, expose only `alias` /
  `areaLabel` / `city` / `approxLocation` (lat/lng rounded to ~2 dp), and contain
  **no** `actualName`, `fullAddress`, `pincode`, or exact `location`. The
  `"SECRET-…"` / `"SECRETLANE"` markers from the seed appear **nowhere**.
- **FAIL:** any real name/address/pincode/exact geo present, or `masked:false`,
  for a caller without a confirmed booking.

### 4.3 Create a hold — and prove a second account cannot double-hold

1. On device A, enter the seeded bedId and tap **Proceed to token payment**. The
   app calls `POST /v1/bookings` (creates the hold).
2. **Concurrently**, before paying, attempt the same bedId from a **second
   device/account** (device B logged in as a *different* KYC-verified tenant), or
   via curl:

   ```bash
   curl -s -X POST https://<staging-host>/v1/bookings \
     -H "Authorization: Bearer <other-tenant-token>" \
     -H "Content-Type: application/json" \
     -d '{"bedId":"<same-bedId>"}' -w '\nHTTP %{http_code}\n'
   ```

This exercises both halves of the inventory invariant (CLAUDE.md rule #3): the
row-locked `SELECT … FOR UPDATE` and the `uniq_live_booking_per_bed` index
([booking.service.ts](../../backend/src/modules/booking/booking.service.ts)).

- **PASS:** device A's hold succeeds (booking `status="TOKEN_PENDING"`,
  `holdExpiresAt` set ~15 min out, bed → `HELD`). Device B / curl is rejected
  with **HTTP 409** (`BED_NOT_AVAILABLE`). Exactly **one** live booking exists
  for that bed.
- **FAIL:** both succeed, or the second returns 5xx, or two live bookings exist
  on one bed.

### 4.4 Pay the token with a Razorpay test card

1. The app calls `POST /v1/bookings/:id/payment`, gets the order, and opens the
   Razorpay checkout with the **test** `keyId`.
2. Confirm the checkout is branded/visibly **Test Mode**.
3. Pay with a Razorpay **test card** (e.g. `4111 1111 1111 1111`, any future
   expiry, any CVV; on the simulated bank page choose **Success**). Consult
   Razorpay's current test-card list if this card changes.

- **PASS:** checkout reports success and the app moves to the "Confirming your
  booking…" screen. Crucially, the booking is **still not confirmed** at this
  instant — server status remains `TOKEN_PENDING` until the webhook lands.
  Verify: `GET /v1/bookings/:id` → `status:"TOKEN_PENDING"` right after the SDK
  success callback.
- **FAIL:** the app shows "Booking confirmed" purely off the SDK callback (would
  violate rule #2), or checkout opens in Live mode.

### 4.5 Assert: confirmation is driven ONLY by the real webhook

The app polls `GET /v1/bookings/:id` and flips to confirmed only when the
**server** says `CONFIRMED`
([booking_poller.dart](../../mobile/lib/features/booking/application/booking_poller.dart)).

1. **App state:** while the webhook is in flight the screen shows **"Confirming
   your booking…"** (it does not declare success).
2. **Razorpay dashboard:** open the webhook deliveries log (§2 step 3) — there is
   a **`payment.captured`** delivery to `…/v1/webhooks/razorpay` with response
   **200**.
3. **Backend:** a `WebhookEvent` row exists `status=PROCESSED`; the booking's
   online `PaymentTransaction` is `CAPTURED` with `razorpayPaymentId` set; the
   booking is `CONFIRMED` (`confirmedAt` set); the bed is `BOOKED`
   ([settlement.ts](../../backend/src/modules/booking/settlement.ts)).
4. **App:** within a few poll cycles (~3–12 s backoff, ≤90 s window) the screen
   flips to **"Booking confirmed"** and now reveals the **unmasked** listing
   (real name + full address) — present only because the server returned the
   private shape post-CONFIRM
   ([booking.serializer.ts](../../backend/src/modules/booking/booking.serializer.ts)).

- **PASS:** all four hold — the app stayed in "confirming" until the **real**
  webhook landed, the dashboard shows the captured event delivered with 200, the
  booking flipped to `CONFIRMED`, and the app then showed the real (previously
  masked) name/address.
- **FAIL:** the app confirmed before any dashboard delivery; the delivery shows a
  non-200 (esp. 400 → secret mismatch, re-check §2); or post-confirm the listing
  is still masked.

> **Idempotency spot-check (recommended):** in the dashboard, **re-deliver** the
> same `payment.captured` event. PASS: server returns `{"status":"duplicate"}`,
> still exactly **one** `CAPTURED` transaction, booking unchanged
> ([webhook.service.ts](../../backend/src/modules/booking/webhook.service.ts) —
> dedupe on `(provider, eventId)`).

### 4.6 Force-quit mid-confirm → reopen reflects true server state

1. During §4.5 step 1 (still "Confirming…"), **force-quit** the app.
2. Reopen, log back in if needed, go to **My bookings**
   ([my_bookings_screen.dart](../../mobile/lib/features/booking/presentation/my_bookings_screen.dart)).

- **PASS:** "My bookings" shows the booking with whatever the server now holds —
  if the webhook has since landed it reads **Confirmed** (unmasked), otherwise
  **Pending**; reopening later flips it to Confirmed once the webhook settles.
  **Exactly one** booking for that bed — none lost, none duplicated. The app
  never invented a confirmation while it was dead.
- **FAIL:** a duplicate booking appears, the booking is missing, or the app shows
  Confirmed while the server still says `TOKEN_PENDING`.

---

## 5. Failure drills

### 5.1 Declined payment → not confirmed, bed releases on expiry

1. Create a fresh hold on an available bed (§4.3).
2. At Razorpay checkout, **fail** the payment (choose Failure on the simulated
   bank page, or cancel the sheet).

- **PASS:**
  - No `payment.captured` is delivered; the booking is **never** `CONFIRMED`.
  - The app shows a failed/timed-out state (it never claims success) and offers
    retry — see `_Stage.paymentFailed` / `ConfirmationTimedOut`
    ([booking_payment_screen.dart](../../mobile/lib/features/booking/presentation/booking_payment_screen.dart)).
  - The bed is **not** bookable by others while the hold is still live
    (`status='HELD'`, booking `TOKEN_PENDING`), and is released after the hold
    expires (next drill).
- **FAIL:** booking becomes `CONFIRMED`, or the app reports success.

### 5.2 Hold expires unpaid → bed returns to AVAILABLE

1. Create a hold and **do not pay**. Note `holdExpiresAt` (~15 min from creation).
2. Wait past `holdExpiresAt`. The expiry sweep
   ([booking-expiry.ts](../../backend/src/jobs/booking-expiry.ts) →
   `expireStaleHolds`, [booking.service.ts](../../backend/src/modules/booking/booking.service.ts))
   moves stale `INITIATED`/`TOKEN_PENDING` holds to `EXPIRED` and frees the bed.
   (Confirm the job/worker is running on staging; trigger its schedule or wait
   for the next tick.)

- **PASS:**
  - After expiry: booking `status='EXPIRED'`, bed `status='AVAILABLE'` again.
  - The bed can now be held by another tenant (repeat §4.3 step 1 succeeds).
  - If the app screen is still open, it shows the **hold-expired** state
    (`ConfirmationHoldExpired`), never a confirmation.
- **FAIL:** the bed stays `HELD` after expiry, or the expired booking can still
  be paid into `CONFIRMED`.

---

## 6. Sign-off checklist

The money flow is **verified** only when **every** box is checked against a real
signed webhook on a device.

| # | Step | PASS condition | Result |
|---|---|---|---|
| 1.2 | Raw SQL applied | postgis ext + both indexes present | ☐ |
| 1.3 | Readiness | `/health/ready` → 200, all checks ok over HTTPS | ☐ |
| 1.5 | KYC | test tenant has `VERIFIED` KycRecord | ☐ |
| 2 | Webhook registered | active, `payment.captured`, secret matches; bad-sig → 400 | ☐ |
| 3.1 | Crashlytics | app launches; Crashlytics on (or guard works if absent) | ☐ |
| 3.3 | API base URL | app talks to staging HTTPS | ☐ |
| 4.1 | OTP login | OTP via SMS; session issued | ☐ |
| 4.2 | Masking pre-booking | `masked:true`, no real name/address/geo | ☐ |
| 4.3 | Hold + double-hold block | A holds; B gets 409; one live booking/bed | ☐ |
| 4.4 | Pay token (test card) | checkout succeeds; still `TOKEN_PENDING` after SDK callback | ☐ |
| 4.5 | Webhook-driven confirm | app waits; dashboard 200 delivery; `CONFIRMED`; unmasked | ☐ |
| 4.5 | Idempotency | re-deliver → `duplicate`, one captured txn | ☐ |
| 4.6 | Force-quit resilience | My bookings = true server state; no loss/dup | ☐ |
| 5.1 | Declined payment | not confirmed; app shows failure | ☐ |
| 5.2 | Hold expiry | booking `EXPIRED`, bed `AVAILABLE` | ☐ |

**Tester:** ____________  **Date:** ____________  **Staging build / commit:** ____________
