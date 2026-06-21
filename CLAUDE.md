# CLAUDE.md — RoomAdda engineering rules

**This file is the single source of truth.** Every session MUST follow it. If a
later instruction conflicts with anything here, **STOP and flag it** instead of
silently complying.

## Product

RoomAdda is a role-based PG-accommodation platform for India. Roles:
**TENANT, HOST, AGENT, ADMIN**. Surfaces:

- **backend** — the API (Fastify + Prisma + PostgreSQL/PostGIS + Redis).
- **mobile** — Flutter app for tenant / host / agent (standalone, not in the pnpm workspace).
- **webadmin** — React + Vite admin console.
- **website** — Next.js marketing site + the "Roomie" assistant.

Shared types and zod contracts live in `packages/shared` (`@roomadda/shared`) and
are the single source of truth for API shapes. The money helpers also live there.

## Domain non-negotiables (NEVER violate)

1. **Money is always integer paise.** Never float. Money fields end in `Paise`
   (e.g. `tokenAmountPaise`). Convert/format only via the shared money helpers
   in `@roomadda/shared` — never ad-hoc arithmetic in a route or component.
2. **Payment truth = a signature-verified Razorpay webhook.** A booking becomes
   `CONFIRMED` only when the verified webhook (plus any cash leg) settles the
   full token amount. **NEVER** confirm from an app-side success screen — the
   client is untrusted.
3. **Inventory is bed-level.** A bed has at most ONE live booking, enforced in
   BOTH places: a DB **partial unique index** (live statuses only) AND a
   **row-locked transaction** (`SELECT … FOR UPDATE`) when booking.
4. **Masking.** A listing's `actualName`, `fullAddress`, and exact geo are
   returned ONLY to a tenant with a CONFIRMED booking on that listing, or to the
   owning host / admin / agent. Public callers get `alias` + `areaLabel` only.
   Enforce this **server-side in the serializer** — never trust the client to
   hide fields.
5. **Just-in-time KYC.** Browsing is open. KYC is required only at the
   booking/token step — never gate discovery behind it.

## Security rules (NEVER violate)

- **Validate every external input with zod at the boundary**, strip unknown keys
  (`.strict()`), and reject on failure. No unvalidated body/query/params reach a
  service.
- **Default-deny authorization.** Every route declares its required role(s); no
  implicit access. Absence of a declared role = denied.
- **Raw SQL only via Prisma tagged templates** with bound parameters
  (`prisma.$queryRaw`\`…\`). Never concatenate or interpolate SQL strings.
- **Secrets come from env only.** Never hardcode, never log them. Redact tokens,
  OTPs, and PII in all logs.
- **Any mutation touching more than one row runs in a transaction**
  (`prisma.$transaction`).
- **External webhooks:** verify the signature on the **raw request body**, then
  enforce **idempotency** (dedupe by event/payment id) before acting.

## Reliability rules

- **Global error handler:** clients get a sanitized message + stable error code;
  full detail goes to logs. No stack traces leak in production.
- **Every list endpoint is cursor-paginated** with an enforced max page size.
- **`/health` (liveness)** and **`/health/ready` (readiness)** endpoints exist
  and are cheap (readiness pings Prisma + Redis).
- **Graceful shutdown** drains in-flight requests and disconnects Prisma + Redis.
- **Process-level `unhandledRejection` / `uncaughtException` handlers** log and
  exit non-zero — let the orchestrator restart the process.

## Conventions

- **TypeScript strict everywhere.** No `any` without a written reason in a
  comment. `strict` + `noUncheckedIndexedAccess` are on in `tsconfig.base.json`.
- **Backend feature layout:** `src/modules/<feature>/{route,service,schema}.ts`
  — route wires HTTP + auth, service holds business logic, schema holds zod.
- **Tests for every service with business logic.** The **bed-booking race** and
  **webhook idempotency** MUST have explicit tests.

## Commands

- `pnpm install` — install all JS workspaces (Corepack provides pnpm).
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` — Turborepo tasks.
- `docker compose up -d` — local PostGIS (`db`) + Redis (`redis`).
- `pnpm --filter @roomadda/backend prisma:generate` — regenerate the Prisma client.

Mobile is separate: `cd mobile && flutter pub get && flutter test`.
