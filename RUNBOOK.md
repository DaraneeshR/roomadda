# RUNBOOK — Run RoomAdda locally

Canonical "bring everything up on a dev machine" guide. Every command here is
derived from the actual repo (root `package.json`, `docker-compose.yml`, each
`.env.example`, the Prisma setup, and the two Flutter apps). Order matters:
**db → backend (health green) → web clients → mobile apps.**

> Notes where this repo differs from common assumptions:
> - **Backend runs on `:3001`** (not 4000). Source of truth: `backend/.env.example`
>   (`PORT=3001`), `backend/src/config/env.ts` (`PORT` default `3001`), and the
>   CORS allowlist. The mobile apps therefore target **`http://10.0.2.2:3001`**.
> - **The OTP dev-stub is active whenever `NODE_ENV !== production`** (i.e. local
>   dev), not because keys are blank. See `backend/src/lib/sms.ts` (`DevSmsSender`).
> - **Local Postgres is on `:5435`** (see gotchas) even though the committed
>   `.env.example` defaults to `5432` — you override it locally.

---

## 1. Prerequisites

| Tool | Version / note |
|------|----------------|
| Node | 20.x (`engines: >=20 <21`) |
| pnpm | 9.x — `corepack enable` then `corepack prepare pnpm@9.15.9 --activate` (pinned in root `package.json`) |
| Docker Desktop | Running, with Compose v2 (`docker compose …`) |
| Flutter | SDK `>=3.22.0`, Dart `>=3.5.0` (mobile pubspecs) |
| Android emulator | Windows host → Android path. Start one from Android Studio (Device Manager) or `emulator -avd <name>` before running the apps. |
| (iOS) | iOS simulator needs **macOS + Xcode** — not available on this Windows host. |
| psql | **Optional.** Only needed for the manual SQL-apply fallback; Prisma can apply the SQL files without it. |

---

## 2. One-time setup

```bash
# from repo root
pnpm install                 # all JS workspaces (backend, webadmin, website, shared)

docker compose up -d         # starts db (PostGIS) + redis
docker compose ps            # WAIT until the `db` row shows (healthy) before continuing
```

`docker compose ps` must show `db` as **healthy** (it has a `pg_isready`
healthcheck) before you run any Prisma command.

### Copy env files

Copy every `*.env.example` to `.env` next to it:

```bash
# PowerShell
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
Copy-Item webadmin\.env.example webadmin\.env
Copy-Item website\.env.example website\.env
Copy-Item mobile\tenant\.env.example mobile\tenant\.env
Copy-Item mobile\host_agent\.env.example mobile\host_agent\.env
```

(Mobile `.env` is optional — the apps also read `--dart-define`; see §5.)

### Which keys to set vs. leave alone (local dev)

**Root `.env`** (read by `docker compose`):

| Key | Local value |
|-----|-------------|
| `POSTGRES_USER` / `POSTGRES_DB` | leave `roomadda` |
| `POSTGRES_PASSWORD` | pick any value — **must match** the password in `backend/.env` `DATABASE_URL` |
| `POSTGRES_PORT` | **set to `5435`** (see §3) |
| `REDIS_PORT` | leave `6379` |

**`backend/.env`** — boot is fail-fast zod-validated (`backend/src/config/env.ts`):

| Key | Required? | Local value |
|-----|-----------|-------------|
| `DATABASE_URL` | yes | `postgresql://roomadda:<password>@localhost:5435/roomadda?schema=public` — **port 5435**, password matches root `.env` |
| `REDIS_URL` | yes | leave `redis://localhost:6379` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | yes (≥32 chars) | generate real ones: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | yes, **non-empty** (zod `min(1)`) | **keep the example placeholders** — no real Razorpay account needed locally; payments just won't settle |
| `MSG91_AUTH_KEY` | yes, **non-empty** | keep the placeholder — OTP uses the dev-stub regardless (`NODE_ENV=development`) |
| `MSG91_OTP_TEMPLATE_ID` / `MSG91_SENDER_ID` | no | leave blank |
| `ANTHROPIC_API_KEY` | no (optional) | leave blank → Roomie endpoint returns `503` (feature off). Everything else works. |
| everything else | no | sensible defaults already in the file |

> "Safe to leave blank" ≠ delete. `RAZORPAY_*` and `MSG91_AUTH_KEY` must stay
> **non-empty** (they're `min(1)`) or the server aborts at boot. The committed
> placeholder values satisfy this. Only `ANTHROPIC_API_KEY`, `MSG91_OTP_TEMPLATE_ID`,
> and `MSG91_SENDER_ID` may be literally empty.

**`webadmin/.env`** → `VITE_API_URL=http://localhost:3001` (default is correct).
**`website/.env`** → `BACKEND_API_URL=http://localhost:3001` (default is correct).
**`mobile/*/.env`** → `API_BASE_URL=http://10.0.2.2:3001` (default is correct).

---

## 3. Project-specific gotchas (read these — they bite)

1. **Postgres is on `:5435`, not `:5432`.** Ports 5432–5434 are taken by other
   local projects. Set `POSTGRES_PORT=5435` in root `.env` and use `…@localhost:5435/…`
   in `backend/.env` `DATABASE_URL`. The committed `.env.example` ships `5432` —
   you must change it. (`docker-compose.yml` publishes `${POSTGRES_PORT:-5432}:5432`,
   so the override takes effect.)

2. **Use `pnpm db:setup` (or `prisma:migrate` → `migrate deploy`), NOT `migrate dev`.**
   `migrate dev` reports false drift against the PostGIS objects (the `geography`
   column + trigger + GiST index that Prisma doesn't model). The `prisma:migrate`
   script is now an alias for the safe `migrate deploy`; the raw `migrate dev` lives
   only behind the explicit `prisma:migrate:dev` script — don't reach for it locally.

3. **Apply the two raw SQL files after migrating, in order.** Prisma can't manage
   them:
   - `backend/prisma/sql/01_postgis.sql` — PostGIS extension, `location` geography
     column, sync trigger, spatial index.
   - `backend/prisma/sql/02_booking_guard.sql` — bed-level booking guard.

   Both are idempotent (safe to re-run). The `db:setup` / `db:sql` scripts run them
   for you (§4); the psql fallback is also in §4.

4. **From the Android emulator the backend is `http://10.0.2.2:3001`, NOT
   `localhost`.** `10.0.2.2` is the emulator's alias for the host machine.
   `localhost` inside the emulator is the emulator itself.

5. **OTP code is printed to the backend terminal.** The dev SMS stub
   (`DevSmsSender`, active when `NODE_ENV !== production`) logs
   `DEV_OTP <phone> <code> (dev stub — not sent via SMS)` instead of sending an
   SMS. Request the OTP, read the code from the backend logs, enter it.

6. **Run `prisma generate` after any schema change or fresh pull.** Done for you
   by `db:setup`; standalone command in §4.

---

## 4. Database (run after db is healthy)

All Prisma commands read `backend/.env` (`DATABASE_URL`, port **5435**). Easiest
is the one-shot `db:setup`, which does **migrate deploy → apply both SQL files →
generate** in the correct order:

```bash
pnpm --filter @roomadda/backend db:setup
```

Equivalent step-by-step (use if you want to run pieces individually):

```bash
pnpm --filter @roomadda/backend prisma:migrate   # = prisma migrate deploy (safe)
pnpm --filter @roomadda/backend db:sql           # applies 01 then 02, in order
pnpm --filter @roomadda/backend prisma:generate
```

`db:sql` runs `prisma db execute … 01_postgis.sql` then `… 02_booking_guard.sql`.

**psql fallback** (optional — if you'd rather apply the SQL by hand, or use any
DB client; apply **01 before 02**):

```bash
# from backend/, with DATABASE_URL pointing at :5435
psql "postgresql://roomadda:<password>@localhost:5435/roomadda" -f prisma/sql/01_postgis.sql
psql "postgresql://roomadda:<password>@localhost:5435/roomadda" -f prisma/sql/02_booking_guard.sql
```

Or paste each file's contents into any SQL client connected to the local DB,
**01 first, then 02**.

---

## 5. Run each surface

Run each in its own terminal. (`pnpm dev` at the root runs all JS surfaces via
Turbo at once, but separate terminals give you clean logs — and the OTP codes.)

### Backend — `:3001`

```bash
pnpm --filter @roomadda/backend dev      # tsx watch src/server.ts
```

Verify health (expect Postgres + PostGIS + Redis all good):

```bash
curl http://localhost:3001/health         # {"status":"ok","uptimeSeconds":…}
curl http://localhost:3001/health/ready   # 200 {"status":"ready","checks":{"database":"ok","postgis":"<version>","redis":"ok"}}
```

`/health/ready` returns **503** with the failing check if Postgres, the PostGIS
extension, or Redis isn't reachable.

### Website (Next.js) — `:3000`

```bash
pnpm --filter @roomadda/website dev      # next dev → http://localhost:3000
```

### Web admin (Vite) — `:5173`

```bash
pnpm --filter @roomadda/webadmin dev     # vite → http://localhost:5173
```

(Both default ports match the backend `CORS_ORIGINS` allowlist.)

### Mobile — tenant app

Each Flutter app is its own package, run from its **own folder**. It pins its
`appAudience` at compile time in `lib/main.dart` (sent to the backend on OTP
verify), so the app you launch determines which roles it accepts.

- **tenant** (`mobile/tenant`) — `appAudience = tenant`, package `com.roomadda.tenant`, TENANT role.
- **host_agent** (`mobile/host_agent`) — `appAudience = host_agent`, package `com.roomadda.hostagent`, HOST + AGENT roles.

First fetch deps (once, from `mobile/`):

```bash
cd mobile
dart run melos run get        # flutter pub get across core + tenant + host_agent
```

Run the tenant app on the booted emulator:

```bash
cd mobile/tenant
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001 --dart-define=APP_ENV=dev
```

### Mobile — host & agent app

```bash
cd mobile/host_agent
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001 --dart-define=APP_ENV=dev
```

> The dev default base URL is already `http://10.0.2.2:3001` if you omit the
> `--dart-define`, but pass it explicitly so you never accidentally hit the wrong
> host. A `tenant` build will reject HOST/AGENT logins (and vice-versa) — that's
> the per-app audience gate, not a bug.

---

## 6. Smoke check (end to end)

1. `docker compose ps` → `db` is **healthy**.
2. `curl http://localhost:3001/health/ready` → `200` with `database:"ok"`,
   `postgis:"<version>"`, `redis:"ok"`.
3. **Webadmin OTP login:** open `http://localhost:5173`, request an OTP, read the
   `DEV_OTP …` line from the **backend terminal**, enter the code → logged in.
4. **Tenant app:** boots on the emulator, OTP login (same dev-stub flow), and
   reaches the **booking screen**. Reaching booking confirms the app split didn't
   break the booking flow.

---

## 7. Common failures

| Symptom | Cause / fix |
|---------|-------------|
| Prisma/`db:setup` can't connect; `docker compose ps` shows nothing | **Docker Desktop not running.** Start it, `docker compose up -d`, wait for `db (healthy)`. |
| `migrate dev` reports drift / wants to reset the DB | You ran `prisma:migrate:dev` (or `prisma migrate dev` directly). Use `pnpm db:setup` or `pnpm prisma:migrate` (→ deploy) instead — never `migrate dev` here. |
| `@prisma/client` types missing / runtime "did you forget to run generate" | **Forgot `prisma generate`** after a schema change or fresh pull. Run `pnpm --filter @roomadda/backend prisma:generate`. |
| Backend boot aborts: "Invalid environment configuration" | A required key is empty. Check `DATABASE_URL` (port 5435), JWT secrets (≥32 chars), and that `RAZORPAY_*` / `MSG91_AUTH_KEY` are non-empty placeholders. |
| Mobile app: network errors / can't reach API | **Pointed at `localhost` instead of `10.0.2.2`.** From the emulator the host is `http://10.0.2.2:3001`. Re-run with the `--dart-define=API_BASE_URL=http://10.0.2.2:3001`. |
| DB connects but `/health/ready` is 503 with `postgis:"missing"` | The SQL files weren't applied. Run `pnpm --filter @roomadda/backend db:sql` (01 then 02). |
| Mobile login rejected (`WRONG_APP`) | You logged a HOST/AGENT into the tenant app or vice-versa — use the matching app for the role. |
