# RoomAdda — Local Demo Runbook

Bring up **backend + webadmin + website + the mobile apps** with seeded data and
walk the tenant booking happy path — on Windows, with **no external services**
(no live keys, no cloud). Everything runs against local Postgres + Redis.

> Ports used: **Postgres 5435** (see note in step 1), **Redis 6379**, **backend
> 3001**, **website 3000**, **webadmin 5173**. The mobile emulator reaches the
> backend at `http://10.0.2.2:3001` (the Android emulator's alias for your host).

Commands are written for **PowerShell** (the default Windows shell). `pnpm`,
`docker`, `flutter`, and `curl` behave the same in Git Bash if you prefer it.

---

## 0. Prerequisites (one-time)

- **Node 20** (`.nvmrc` pins `20`) and **pnpm via Corepack**: `corepack enable`.
- **Docker Desktop** (for Postgres + Redis).
- For the mobile apps only: **Flutter SDK** on `PATH` + an **Android emulator**
  (Android Studio → Device Manager → create & start a device).

### Environment files

The `.env` files are gitignored, so a fresh clone needs them copied from the
committed `*.example` files. From the repo root:

```powershell
Copy-Item .env.example .env                       # docker: Postgres/Redis ports
Copy-Item backend\.env.example backend\.env       # backend service config
Copy-Item website\.env.example website\.env       # website → BACKEND_API_URL
Copy-Item webadmin\.env.example webadmin\.env     # webadmin → VITE_API_URL
```

Leave the Razorpay / MSG91 placeholder values **as-is** — they are non-empty dev
placeholders the backend requires to boot, and nothing real is called locally.
(Do not blank them; the backend refuses to start with empty required keys.)

> **Postgres port — 5432 vs 5435.** The default is **5432**. This machine already
> has another Postgres on 5432, so the committed local config uses **5435**: root
> `.env` sets `POSTGRES_PORT=5435` and `backend\.env`'s `DATABASE_URL` points at
> `...@localhost:5435/...`. If you change the port, change it in **both** files so
> they stay in sync. The rest of this doc assumes **5435**.

### Install workspace deps + build the shared package

```powershell
pnpm install
pnpm --filter @roomadda/shared build   # backend imports the BUILT @roomadda/shared
```

---

## 1. Infrastructure (Postgres + Redis)

From the repo root:

```powershell
docker compose up -d
docker compose ps                 # both services should read "healthy"
```

Confirm the database is reachable (should print `... accepting connections`):

```powershell
docker compose exec db pg_isready -U roomadda -d roomadda
```

Create the schema + PostGIS (idempotent — safe to re-run):

```powershell
pnpm --filter @roomadda/backend db:setup
```

`db:setup` runs `prisma migrate deploy`, applies the PostGIS SQL
(`prisma/sql/01_postgis.sql`, `02_booking_guard.sql`), and `prisma generate`.

---

## 2. Backend + demo data

**Terminal A** — start the API (keep it running; the OTP codes print here):

```powershell
pnpm --filter @roomadda/backend dev
```

Verify readiness (in another terminal). Expect
`{"status":"ready","checks":{"database":"ok","postgis":"3.4.3","redis":"ok"}}`:

```powershell
curl http://localhost:3001/health/ready
```

**Terminal B** — seed the demo data (idempotent — safe to re-run):

```powershell
pnpm --filter @roomadda/backend demo:seed
```

This prints the demo accounts. There are **no passwords** — every login is a
mobile OTP. Because there is no SMS gateway locally, the **6-digit code is logged
to Terminal A** as `DEV_OTP <phone> <code>` each time you request one.

| Role | Phone | Use it in |
| --- | --- | --- |
| **ADMIN** | `+919000000001` | webadmin console |
| **HOST** (KYC ✔) | `+919000000002` | Host & Agent app — owns 3 published PGs |
| **TENANT** (KYC ✔) | `+919000000003` | Tenant app — **can book** |
| **TENANT** (plain) | `+919000000004` | Tenant app — KYC not done |
| **AGENT** (city: Bengaluru) | `+919000000005` | Host & Agent app — 1 scheduled visit |

Seeded listings: **3 PUBLISHED PGs in Bengaluru** — Sunrise PG (Koramangala),
Green Nest PG (HSR Layout), Lakeview PG (Indiranagar) — each with 5 photos, priced
rooms, and available beds, satisfying the §9.2 go-live gate.

---

## 3. Webadmin (admin console)

```powershell
pnpm --filter @roomadda/webadmin dev      # → http://localhost:5173
```

1. Open **http://localhost:5173** → you're redirected to the login page.
2. Enter the **admin** phone `+919000000001` → **Send code**.
3. Read the `DEV_OTP +919000000001 <code>` line from **Terminal A**, enter the
   6-digit code → **Verify**.
4. You land in the console (the login is gated to `ADMIN` — any other role is
   rejected). Walk the review queues: **KYC** (approve/reject), **Listings**
   (publish/suspend — the seeded PGs are already published), **Bookings**,
   **Payments**, and **Cash-in-hand / cash collections** for agents.

---

## 4. Website (marketing + discovery + login modal)

```powershell
pnpm --filter @roomadda/website dev       # → http://localhost:3000
```

1. Open **http://localhost:3000** — discovery is **open to anonymous visitors**
   (no login required). Search **Bengaluru**, or browse a city; the 3 seeded PGs
   appear as cards (masked: alias + area only).
2. Click **Log in** → the non-blocking **login modal** opens. Enter a tenant
   phone (e.g. `+919000000003`) → **Send code** → read the `DEV_OTP` from
   Terminal A → enter it. New numbers are prompted for name + gender.
3. Open a listing to see the masked public detail. (KYC is just-in-time — required
   only at the booking step, never to browse.)

---

## 5. Tenant app — the booking happy path

Start an **Android emulator**, then:

```powershell
cd mobile
dart run melos run get                     # fetch deps for core + tenant + host_agent
cd tenant
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001 --dart-define=APP_ENV=dev
```

Walk it (read every OTP from **Terminal A**):

1. **OTP login** — phone `+919000000003` (the KYC-verified tenant). The Tenant app
   only accepts TENANT numbers; a host/agent number returns `WRONG_APP`.
2. **Search** Bengaluru → open a listing. Public detail is **masked** (alias +
   area label; no real name/address/exact pin).
3. **Book** a bed → the hold is created (`TOKEN_PENDING`), token ₹2,000.
4. **Pay token online** → the app creates the Razorpay order, then opens the
   Razorpay sheet. **Locally this sheet cannot complete** — see the note below.
5. **Confirm the payment locally** (Terminal B):

   ```powershell
   pnpm --filter @roomadda/backend demo:confirm
   ```

   This fires the signed `payment.captured` webhook — the exact trust boundary the
   real gateway uses — and settles the booking to **CONFIRMED**.
6. In the app open **My bookings** → the booking is **CONFIRMED**, masking has
   **lifted** (host name + full address now visible) → **Download receipt** (PDF).

### Why step 4 needs step 5 (payment is stubbed locally)

Payment truth is a **signature-verified Razorpay webhook** — the client never
self-confirms (`/CLAUDE.md` #2). Locally the Razorpay gateway is **stubbed**: it
returns a fake `order_stub_…` order, and even with a real test key the gateway's
server→server webhook **can't reach `localhost`**. So no real callback can arrive.
`demo:confirm` stands in for that callback with zero external services: it looks up
the newest booking awaiting an online payment, builds the `payment.captured`
event, signs it with the local `RAZORPAY_WEBHOOK_SECRET`, and POSTs it to
`/v1/webhooks/razorpay`. The booking then settles to `CONFIRMED` exactly as it
would in production.

> To drive the **real** Razorpay test checkout instead, you'd need a genuine
> `rzp_test_…` key, code changes to force the live gateway client in dev, **and** a
> public tunnel (e.g. ngrok) so the webhook can reach your machine — all outside a
> no-cloud local demo, so this runbook uses `demo:confirm`.
>
> Target a specific booking with `pnpm --filter @roomadda/backend demo:confirm <bookingId>`.

---

## 6. Host & Agent apps

Both roles share one app (`mobile/host_agent`). Run it on the same emulator (stop
the tenant app first, or use a second emulator):

```powershell
cd mobile\host_agent
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001 --dart-define=APP_ENV=dev
```

**Host** — log in with `+919000000002`:
- Listings dashboard: the 3 seeded PGs (PUBLISHED), each with rooms/beds inventory.
- Roster / bookings: after you run the tenant happy path above, the confirmed
  tenant appears on that PG.
- Walk-in, broadcasts, meal menu, service requests — the host toolset.

**Agent** — log in with `+919000000005` (zone: **Bengaluru**):
- Today's assigned **visits**: the seeded `SCHEDULED` visit on Sunrise PG
  (Koramangala). Open it to walk the visit → inspection flow.
- The agent is **zone-locked** to Bengaluru and never handles money.

---

## 7. What works vs. what's stubbed locally

Everything below is **by design** in dev — a stub firing is not a bug. Live keys /
cloud are needed only in production.

| Capability | Local behavior |
| --- | --- |
| **OTP login** (MSG91 SMS) | ✅ Works via dev stub — code is **logged to the backend terminal** as `DEV_OTP …`, not texted. |
| **Discovery / search / masking** | ✅ Fully works (Postgres + PostGIS). |
| **Booking hold + inventory (bed lock)** | ✅ Fully works. |
| **Booking confirmation (Razorpay)** | ⚠️ Gateway **stubbed** (fake `order_stub_…`; webhook can't reach localhost). Confirm with **`demo:confirm`** (signed webhook). Real test-mode checkout needs a real key + a tunnel. |
| **Receipt PDF, admin console, host/agent surfaces** | ✅ Fully works. |
| **KYC** (status + booking gate) | ✅ Logic works; the seed sets host/tenant KYC `VERIFIED` directly. Document **upload** is stubbed (S3 presign points to a non-resolving stub host — bytes don't persist). |
| **Object storage** (S3: KYC + listing photos) | ⚠️ **Stubbed** — presigned URLs are non-functional; nothing uploads. Seeded photos use public placeholder image URLs. |
| **WhatsApp / rent reminders** (MSG91 BSP) | 🔕 Dev no-op (logged). |
| **Firebase** (chat transport + Crashlytics) | 🔕 Stubbed — chat still mirrors to Postgres; Crashlytics runs guarded/disabled. |
| **Google Places** (mobile search autocomplete) | 🔕 Empty key → falls back to free-text city/area search. |
| **Roomie assistant** (Anthropic) | 🔕 Disabled unless `ANTHROPIC_API_KEY` is set → `POST /v1/roomie` returns 503; the website widget shows a stub reply. |
| **SOS ops alerting** | 🔕 Dev logs the alert (no real SMS/webhook dispatch). |

---

## Troubleshooting

- **Backend aborts: "Invalid environment configuration".** A required key is empty
  in `backend\.env`. Check `DATABASE_URL` (port **5435**), the two JWT secrets (≥32
  chars), and that `RAZORPAY_*` + `MSG91_AUTH_KEY` keep their non-empty placeholders.
- **`/health/ready` returns 503.** Postgres or Redis isn't up, or PostGIS isn't
  installed. Re-run `docker compose up -d` and `pnpm --filter @roomadda/backend db:setup`.
- **Port 5435 in use / can't connect.** Something else owns your Postgres port.
  Change `POSTGRES_PORT` (root `.env`) **and** the `DATABASE_URL` port (`backend\.env`)
  to a free port, then `docker compose up -d` again.
- **`demo:confirm` says "No booking is awaiting an online payment".** In the tenant
  app, book a bed and tap **Pay token online** once (that creates the order), then
  re-run it.
- **Emulator can't reach the API.** Use `http://10.0.2.2:3001` (not `localhost`)
  in `--dart-define=API_BASE_URL`; `10.0.2.2` is the emulator's alias for your host.
- **`WRONG_APP` on mobile login.** You used a role's number in the other app —
  tenant numbers → Tenant app; host/agent numbers → Host & Agent app.
- **CORS error in webadmin/website.** The backend allowlist (`CORS_ORIGINS` in
  `backend\.env`) must include `http://localhost:5173` and `http://localhost:3000`
  (it does by default).
