# PRD Coverage Audit — RoomAdda

Audit of **every P0 / P1 feature** in the RoomAdda PRD against what actually
exists in this repository. This is a **status report only — no features were
built or changed** while producing it.

- **Canonical source PRD (committed):**
  [`docs/PRD/RoomAdda_PRD_master.docx`](PRD/RoomAdda_PRD_master.docx). This is the
  team's master PRD (a byte‑for‑byte copy of `RoomAdda_PRD_Final (4).docx`), now
  versioned in the repo so coverage tracks against a fixed source. **All section
  numbers in the tables below refer to this file:** Tenant §3, Host §4, Agent §5,
  Website §6, Admin §7, Payments §8, Privacy/Business rules §9, Integrations §10,
  and **ERP — Back‑Office Operations & Finance §15** (§§15.1–15.8).
- **Don't confuse the numbering with the design references.** The repo also has
  two HTML design references —
  [`Roomadda_MVP_Plan.html`](../design/reference/Roomadda_MVP_Plan.html) and
  [`Roomadda_Website_Master_Blueprint.html`](../design/reference/Roomadda_Website_Master_Blueprint.html)
  — which use their **own, different** numbering (e.g. the MVP Plan numbers Website
  §7 / Admin §6; the Blueprint's **§15 is "Integrations," not ERP**). They are
  visual/copy specs; the `.docx` above is authoritative for sections and P0/P1
  tags. The **ERP (§15) appears only in the `.docx`** — its repo status is
  unambiguous either way: **no ERP code exists.**
- **Scope:** lines the PRD tags `[P0]` / `[P1]`, plus the backend invariants
  §8/§9 mandates as non‑negotiable (no per‑line tag but P0 by mandate) and the
  `[P0]` integrations in §10.
- **Method:** read the PRD references, then read the code. Routes were enumerated
  from `backend/src/modules/**/*.route.ts`; the data model from
  `backend/prisma/schema.prisma`; clients from `mobile/`, `website/`, `webadmin/`.

## Legend

| Status | Meaning |
|---|---|
| ✅ **Done** | Implemented and backed by code that is pointed to. Never assigned without evidence. |
| 🟡 **Partial** | Some of it exists; the **Gap** column names exactly what is missing. |
| ⛔ **Missing** | No implementing code found in the repo. |

## Score (P0/P1 lines only)

| Surface | Lines | ✅ Done | 🟡 Partial | ⛔ Missing |
|---|--:|--:|--:|--:|
| Backend (integrations + invariants) | 3 + 9 | 7 | 2 | 3 |
| Tenant app | 21 | 0 | 4 | 17 |
| Host & Agent app | 17 | 0 | 0 | 17 |
| Website | 36 | 0 | 9 | 27 |
| Webadmin (Admin Dashboard) | 12 | 0 | 6 | 6 |
| ERP (§15) | 10 | 0 | 0 | 10 |

> Headline: the **backend payment/booking/masking core is real and well‑tested**;
> the **admin console and public website cover discovery + approvals partially**;
> the **two mobile apps are skeletons** (only the tenant booking‑payment flow is
> wired); the **ERP (§15) does not exist** in any form.

---

## 1. Backend (API & data model)

The backend is `Node 20 + Fastify 5 + Prisma 6 + PostgreSQL/PostGIS + Redis`
(`README.md`, `backend/`). Routes are registered in `backend/src/app.ts`.

### 1a. §10 Headline integrations

| Feature | PRD | Pri | Status | Evidence / Gap |
|---|---|---|---|---|
| Razorpay | §10 | P0 | 🟡 Partial | **Have:** order creation + signature‑verified webhook is the sole confirmation path — `backend/src/lib/razorpay.ts` (`createOrder`, `verifyRazorpaySignature`), `backend/src/modules/booking/payment.service.ts`, `webhook.service.ts`, `POST /v1/webhooks/razorpay`. **Gap:** no refunds (no `refund()` in `razorpay.ts`), no payment links, no QR. |
| Google Maps Platform (full suite) | §10 | P0 | 🟡 Partial | **Have:** geo proximity search server‑side via PostGIS `ST_DWithin` — `backend/src/modules/listing/listing.service.ts` (`nearby`), `prisma/sql/01_postgis.sql`, `GET /v1/listings/search/nearby`. **Gap:** none of the six Google APIs (Places Autocomplete, Maps JS/SDK, Geolocation, Distance Matrix, Static Maps, Geocoding) are integrated. |
| WhatsApp Business API | §10 | P0 | ⛔ Missing | No WhatsApp/BSP code anywhere (grep `whatsapp|gupshup|interakt|wati` = 0). No transactional templates, no booking/rent/price‑drop messages. |

### 1b. §8/§9 Backend invariants (P0 by mandate)

These have no per‑line `[P0]` tag but the PRD calls them non‑negotiable and they
back many client features above.

| Invariant | PRD | Status | Evidence / Gap |
|---|---|---|---|
| Payment truth = signature‑verified webhook (never a success screen) | §8.2 | ✅ Done | `backend/src/modules/booking/webhook.service.ts` verifies signature over raw body; `settlement.ts` is the only place a booking becomes `CONFIRMED`. Tests: `booking.read.integration.test.ts`, `booking.integration.test.ts`. |
| Webhook idempotency (dedupe by event id) | §8.2 | ✅ Done | `WebhookEvent` `@@unique([provider, eventId])` in `schema.prisma`; replay skipped in `webhook.service.ts`. |
| Money as integer paise | §8.3 | ✅ Done | `backend/src/lib/money.ts` (`assertPaise`); every money column is `Int …Paise` in `schema.prisma`; shared helpers `packages/shared/src/money.ts`. |
| Double‑booking prevented (row lock **and** partial unique index) | §8.3 / §9.2 | ✅ Done | `booking.service.ts` `SELECT … FOR UPDATE`; `prisma/sql/02_booking_guard.sql` partial unique index. |
| Address / exact geo masked until CONFIRMED (server‑side) | §9.1 | ✅ Done | `backend/src/modules/listing/serializer.ts` (`toPublic/toPrivateListing`, `canViewPrivateListing`); `booking.serializer.ts`; `serializer.test.ts`. |
| Just‑in‑time KYC gate enforced at payment | §9.2 | ✅ Done | `app.requireKyc` preHandler on `POST /v1/bookings` and `/bookings/:id/payment` (`booking.route.ts`); `backend/src/plugins/auth.ts`. |
| Admin cannot create a booking (403) | §9.2 | ✅ Done | `POST /v1/bookings` is `requireRole("TENANT")`; default‑deny denies ADMIN (`booking.route.ts`, `plugins/auth.ts`). |
| Refund policy (full / 50% / none by timing) applied in code | §8.4 | ⛔ Missing | No cancellation/refund endpoint or logic. A `REFUNDED` value exists in the payment/transaction status enums (`schema.prisma`, `packages/shared/src/contracts.ts`) but **nothing ever sets it**, and `razorpay.ts` exposes only `createOrder` + `verifyRazorpaySignature` — no `refund()` call. |
| Zone‑based agent data access | §9.1 | ⛔ Missing | No agent zone/territory model or enforcement in any route. |

> Also present but **not P0/P1‑tagged** (so excluded from the score): hold‑expiry
> sweep (`backend/src/jobs/booking-expiry.ts` → `EXPIRED`), audit log
> (`lib/audit.ts` + `AuditLog`), Roomie assistant (`POST /v1/roomie`,
> `modules/roomie/`), ad/featured slots, health/readiness, OTP rate‑limiting.

---

## 2. Tenant app (`mobile/tenant`)

Only the **booking‑payment flow** is built. The shell (`tenant_shell.dart`) is a
bed‑id text box, not a discovery surface. Shared auth UI lives in
`mobile/core/lib/src/auth_ui/`.

| Feature | PRD | Pri | Status | Evidence / Gap |
|---|---|---|---|---|
| Mobile OTP Registration & Login | §3.1 | P0 | 🟡 Partial | **Have:** OTP login UI + session in secure storage — `mobile/core/lib/src/auth_ui/login_screen.dart`, `auth/secure_token_store.dart`; backend `POST /v1/auth/otp/{request,verify}`. **Gap:** no biometric login; no in‑app 3‑attempt lockout / 60s resend timer UX. |
| Google Sign‑In | §3.1 | P0 | ⛔ Missing | No Google/Firebase auth in app or backend (grep = 0). |
| Profile Setup | §3.1 | P0 | ⛔ Missing | No profile screen; `User` has only `fullName/email` — no gender/DOB/occupation/college; no profile‑update endpoint. |
| KYC Document Upload | §3.1 | P0 | ⛔ Missing | No upload screen and **no intake endpoint** (only `/admin/kyc` review side exists). No encrypted store / signed URL. |
| Location Search w/ Autocomplete | §3.2 | P0 | ⛔ Missing | No search screen in the tenant app; no Google Places. |
| Advanced Filters | §3.2 | P0 | ⛔ Missing | No filter UI (backend `listFiltersSchema` exists but unused by the app). |
| Search Results — List View | §3.2 | P0 | ⛔ Missing | No results screen. |
| Map View — Nearby PGs | §3.2 | P0 | ⛔ Missing | No map screen. |
| PG Detail Page | §3.2 | P0 | ⛔ Missing | No detail screen (backend `GET /v1/listings/:id` exists, unused). |
| Compare Properties | §3.2 | P0 | ⛔ Missing | Not implemented. |
| Booking Initiation | §3.3 | P0 | 🟡 Partial | **Have:** hold creation from a bed id — `mobile/tenant/lib/features/booking/presentation/booking_payment_screen.dart` → `POST /v1/bookings`; DB‑level double‑booking guard. **Gap:** no booking sheet (room‑type / move‑in date / meal‑plan selection), no Instant‑vs‑Request flow, no cancellation policy shown. |
| Token Payment | §3.3 | P0 | 🟡 Partial | **Have:** Razorpay open → poll `GET /v1/bookings/:id` until webhook‑driven `CONFIRMED` — `booking_payment_screen.dart`, `application/booking_poller.dart` (+ `test/booking_poller_test.dart`). **Gap:** no PDF receipt, no WhatsApp to user, no push to host, success screen lacks host/move‑in details. |
| Booking History & Status Tracking | §3.3 | P0 | 🟡 Partial | **Have:** "My bookings" list, masked/private per status — `features/booking/presentation/my_bookings_screen.dart`, `application/my_bookings_controller.dart` → `GET /v1/bookings`. **Gap:** no real‑time push updates, no booking‑detail view with payment history / cancel / contact‑host actions. |
| Wishlist / Saved PGs | §3.3 | P1 | ⛔ Missing | No wishlist model, endpoint, or UI. |
| Home Dashboard — Active Stay View | §3.4 | P0 | ⛔ Missing | No post‑move‑in dashboard. |
| Daily Meal Menu View | §3.4 | P0 | ⛔ Missing | No meal‑menu model/endpoint/UI. |
| Monthly Rent Payment | §3.4 | P0 | ⛔ Missing | No recurring‑rent model/endpoint/UI (only the booking token exists). |
| Service Request (Maintenance) | §3.4 | P0 | ⛔ Missing | No service‑request model/endpoint/UI. |
| In‑App Chat — Tenant ⇄ Host | §3.4 | P0 | ⛔ Missing | No chat model/endpoint/UI. |
| Leave Notice Submission | §3.4 | P1 | ⛔ Missing | Not implemented. |
| Trusted Contacts & SOS | §3.5 | P0 | ⛔ Missing | No trusted‑contacts/SOS model, SMS path, or UI. |

---

## 3. Host & Agent app (`mobile/host_agent`)

The app is a **skeleton**: role routing only, both shells are placeholders
(`features/host/presentation/host_shell.dart` and
`features/agent/presentation/agent_shell.dart` render a single centered string and
dead nav). No host or agent feature is built.

| Feature | PRD | Pri | Status | Evidence / Gap |
|---|---|---|---|---|
| Host Registration & KYC | §4.1 | P0 | ⛔ Missing | Skeleton `host_shell.dart`; no host onboarding / ownership‑proof flow. |
| Property Listing Creation — 7‑step form | §4.1 | P0 | ⛔ Missing | No app form. (Backend primitives only: `POST /v1/listings`, `/rooms`, `/rooms/:id/beds`, `/photos` in `listing.route.ts`.) |
| Edit Listing Details | §4.1 | P0 | ⛔ Missing | No app UI. (Backend `PATCH /v1/listings/:id` exists; no major‑edit re‑approval logic, no edit history.) |
| Daily Inventory Update | §4.2 | P0 | ⛔ Missing | No host inventory UI; no manual‑adjust endpoint; no waitlist. |
| Booking Request Management | §4.2 | P0 | ⛔ Missing | No Request‑to‑Book accept/decline, no 24h countdown; schema has no instant/request flag. |
| Walk‑In Booking Entry (host) | §4.2 | P0 | ⛔ Missing | No walk‑in endpoint/UI; no SMS invite. |
| Tenant Roster | §4.2 | P0 | ⛔ Missing | Not implemented. |
| Meal Menu Update | §4.3 | P0 | ⛔ Missing | No meal‑menu model/endpoint/UI. |
| Service Request Queue | §4.3 | P0 | ⛔ Missing | No service‑request model/endpoint/UI. |
| Broadcast Message to All Tenants | §4.3 | P0 | ⛔ Missing | Not implemented. |
| Basic Revenue Dashboard | §4.4 | P1 | ⛔ Missing | Not implemented. |
| Agent Dashboard — Today's Tasks | §5.1 | P0 | ⛔ Missing | Skeleton `agent_shell.dart`. |
| Property Visit Assignment & GPS Check‑In | §5.2 | P0 | ⛔ Missing | `AgentVisit` model exists (`scheduledAt/visitedAt/notes`) but no GPS check‑in, no assignment endpoint, no UI. |
| Property Inspection Checklist | §5.2 | P0 | ⛔ Missing | No checklist fields/endpoint/UI. |
| Assisted Booking Flow | §5.3 | P0 | ⛔ Missing | No payment‑link‑to‑user flow; no agent attribution. |
| Walk‑In Booking Entry (Agent) | §5.3 | P0 | ⛔ Missing | No agent walk‑in booking/QR/receipt UI. (Backend has a cash leg primitive only: `CashCollection` + `PATCH /v1/cash-collections/:id/{collect,reconcile}`.) |
| Agent Monthly Performance Summary | §5.4 | P1 | ⛔ Missing | Not implemented. |

---

## 4. Website (`website`, Next.js App Router)

A basic SSR **discovery** site: home, search, listing detail, city landing,
Roomie widget. No auth, booking, payments, wishlist, dashboards, or host portal.

| Feature | PRD | Pri | Status | Evidence / Gap |
|---|---|---|---|---|
| Immersive Hero with a Real Search Bar | §6.2 | P0 | 🟡 Partial | **Have:** hero heading + search form — `website/app/page.tsx`, `components/SearchForm.tsx`. **Gap:** no rotating gallery/video, no trust chips, not sticky‑on‑scroll. |
| Smart Search Bar (Places + Use My Location) | §6.2 | P0 | 🟡 Partial | **Have:** text city/area/gender/sharing/rent → `/search?…` URL — `components/SearchForm.tsx`. **Gap:** no Google Places autocomplete, no "use my location", no move‑in date, no recent searches. |
| Live Stats Bar (count‑up) | §6.2 | P0·Fix | ⛔ Missing | Not on `page.tsx`. |
| Browse‑by‑Category Tabs with Live Counts | §6.2 | P0 | ⛔ Missing | Not implemented. |
| Featured & Trending Properties | §6.2 | P0 | 🟡 Partial | **Have:** featured grid — `page.tsx` → `lib/api.ts` `featured()` → `GET /v1/featured`; `components/ListingGrid.tsx`. **Gap:** no "trending", no live‑proof line, card lacks rich anatomy. |
| Coverage Map, App‑Download Band & Social Proof | §6.2 | P0/New | ⛔ Missing | No city‑wide pin map, app band, testimonials, or Instagram embed. |
| Split View — List + Live Map | §6.3 | P0 | 🟡 Partial | **Have:** SSR list + cursor "Next page" — `website/app/search/page.tsx`. **Gap:** no map at all, no list↔map sync, no "Search this area", no AJAX/skeletons. |
| Listing Card Anatomy | §6.3 | P0·Fix | 🟡 Partial | **Have:** photo, name, area, price‑from, availability — `components/ListingCard.tsx`. **Gap:** no photo carousel, trust badges, wishlist heart, premium price, distance, rating, live proof, "+N more". |
| Sticky Filter Bar + Sort | §6.3 | P0 | 🟡 Partial | **Have:** filter form writes URL params — `search/page.tsx`, `SearchForm.tsx`. **Gap:** not sticky, partial filter set, no Sort, no removable chips, no count badge. |
| Hero — Photo Grid + Full‑screen Lightbox | §6.5 | P0 | 🟡 Partial | **Have:** photo grid — `website/app/listing/[id]/page.tsx`. **Gap:** no hero+2×2 layout, no full‑screen lightbox, no WebP pipeline. |
| Header — Name, Badges, Rating, Live Proof + Pricing | §6.5 | P0 | 🟡 Partial | **Have:** name + price + room table (live availability) — `listing/[id]/page.tsx`. **Gap:** no badges, rating, or live‑proof row. |
| Sticky Booking Panel (Airbnb pattern) | §6.5 | P0 | ⛔ Missing | No booking panel — the web takes no bookings. |
| Details on Scroll (sticky tab nav) | §6.5 | P0 | ⛔ Missing | Not implemented. |
| Location, Nearby & Commute | §6.5 | P0 | 🟡 Partial | **Have:** approx‑location map — `components/ApproxMap.tsx` on the detail page. **Gap:** no nearby‑landmarks table, no commute widget, no directions. |
| Reviews & Ratings | §6.5 | P0 | ⛔ Missing | No review model/endpoint/UI. |
| Similar PGs Carousel | §6.5 | P0 | ⛔ Missing | Not implemented. |
| Razorpay Integration (web = app) | §6.6 | P0 | ⛔ Missing | No web booking/checkout/payment. |
| Monthly Rent Payment on Web | §6.6 | P0 | ⛔ Missing | Not implemented. |
| Login / Register Modal (shared identity) | §6.7 | P0 | ⛔ Missing | No web auth at all. |
| Wishlist with Named Collections | §6.7 | P0 | ⛔ Missing | Not implemented. |
| My Bookings & Receipts | §6.7 | P0 | ⛔ Missing | Not implemented. |
| Tenant Dashboard (Web) | §6.7 | P0 | ⛔ Missing | Not implemented. |
| KYC Upload, Profile & Notifications Centre | §6.7 | P0 | ⛔ Missing | Not implemented. |
| Host Dashboard | §6.8 | P0 | ⛔ Missing | No host portal. |
| List a Property — 8‑step Guided Form | §6.8 | P0 | ⛔ Missing | Not implemented. |
| Manage Listings & Inventory | §6.8 | P0 | ⛔ Missing | Not implemented. |
| Bookings, Tenants & Walk‑ins | §6.8 | P0 | ⛔ Missing | Not implemented. |
| Meal Menu, Service Queue & Revenue | §6.8 | P0 | ⛔ Missing | Not implemented. |
| Badge Engine (rules, cron, expiry, override) | §6.9 | P0 | ⛔ Missing | Only paid "Featured" via ad slots (`modules/ad/`). No rule‑driven trust‑badge engine/cron; `TrustTag` model has 4 kinds but no awarding logic or read API. |
| "X people viewing now" | §6.10 | P0 | ⛔ Missing | No Redis session‑viewer counter. |
| "Booked Y times in last 5d/week/month" | §6.10 | P0 | ⛔ Missing | No booking‑recency aggregation. |
| Other live signals (wishlist count, only‑N‑left, last‑booked, price‑drop) | §6.10 | P0/New | ⛔ Missing | Not implemented. |
| Compare Properties | §6.11 | P0·Diff | ⛔ Missing | Not implemented. |
| Cost of Living in This Area | §6.11 | P0·Diff | ⛔ Missing | Not implemented. |
| Area Insights & Price Ranges | §6.11 | P0/New | ⛔ Missing | Not implemented. |
| Enhanced Wishlist Card & Dual Booking Paths | §6.11 | P0/Enh | ⛔ Missing | Not implemented. |

> §6.12 Roomie is implemented (`website/components/RoomieWidget.tsx`,
> `website/app/api/roomie/route.ts` → backend `POST /v1/roomie`) but is tagged
> `[Flagship]`/`[New]`, not P0/P1, so it is out of scope for the score.

---

## 5. Webadmin — Admin Dashboard (`webadmin`, React + Vite)

Pages exist for the discovery/approval slice; management, analytics, oversight,
CMS, and notifications do not. Admin API is `backend/src/modules/admin/`.

| Feature | PRD | Pri | Status | Evidence / Gap |
|---|---|---|---|---|
| Platform Overview Dashboard | §7.1 | P0 | 🟡 Partial | **Have:** metrics dashboard — `webadmin/src/pages/DashboardPage.tsx` → `GET /v1/metrics` (`modules/metrics/`): listings, bookings‑by‑status, settled payments, KYC‑pending, ads‑pending, agent cash‑in‑hand. **Gap:** no total users / active hosts / active tenants / escalations, no 30‑day bookings chart, no live activity feed, figures not click‑through. |
| Listing Approvals Queue | §7.2 | P0 | 🟡 Partial | **Have:** queue + publish/suspend — `pages/ListingsReviewPage.tsx` → `GET /v1/admin/listings`, `POST /v1/admin/listings/:id/{publish,suspend}`. **Gap:** `publishListing` does **not** enforce the §9.2 go‑live gate (min‑5 photos + verified host KYC + priced room) — `admin.service.ts` just flips status; no approve‑with‑edit / request‑info / mandatory reject reason, no inspection‑report view, no 48h SLA highlight, no host email/SMS. |
| User Management | §7.3 | P0 | 🟡 Partial | **Have:** role change only — `pages/UsersRolesPage.tsx` → `PATCH /v1/users/:id/role`. **Gap:** no user search/list, suspend/ban, manual credit, internal notes, booking/payment history view. |
| Host Management | §7.4 | P0 | ⛔ Missing | No host management page or endpoints. |
| Agent Management | §7.5 | P0 | ⛔ Missing | No agent create/list/territory/visit‑assignment endpoints or UI. |
| User KYC Management | §7.6 | P0 | 🟡 Partial | **Have:** KYC queue + approve/reject — `pages/KycReviewPage.tsx` → `GET /v1/admin/kyc`, `POST /v1/admin/kyc/:id/{approve,reject}` (`admin.service.ts`, audited). **Gap:** cannot view documents (no signed‑URL retrieval; `KycRecord.docRef` is an opaque token), no encryption pipeline, no resubmit push. |
| Bookings & Payments | §7.7 | P0 | 🟡 Partial | **Have:** read‑only tables — `pages/BookingsPage.tsx`, `PaymentsPage.tsx`, `CashReconciliationPage.tsx` → `GET /v1/admin/{bookings,payments,cash-collections,agents/cash-in-hand}`. **Gap:** no manual confirm/cancel, no Razorpay refund, no WhatsApp reminder, no revenue summary. |
| Revenue Analytics | §7.8 | P0 | ⛔ Missing | No analytics endpoints, conversion funnel, or Excel/CSV export. |
| Service Request Oversight & Escalations | §7.9 | P0 | ⛔ Missing | No service‑request domain exists. |
| Trust‑tag & Featured Control | §7.10 | P0/New | 🟡 Partial | **Have:** Featured (paid) control — `pages/AdsApprovalPage.tsx`, `AdPricingPage.tsx` → `modules/ad/`. **Gap:** no trust‑badge view/suspend (no badge engine). |
| CMS + SEO Tools | §7.11 | P0/New | ⛔ Missing | No CMS for homepage order, blog, FAQs, landing copy, or per‑page meta. |
| Push & WhatsApp Broadcast | §7.12 | P1 | ⛔ Missing | No notification/broadcast composer or backend. |

---

## 6. ERP — Back‑Office Operations & Finance (§15)

**Nothing in §15 exists in the repository.** There is no ERP app, no commission
or invoice domain, and no money engine. Searches for
`commission|invoice|erp|money manager|payout|pro-rata` return zero hits in
`backend/src`, `webadmin/src`, `website`, `mobile`, and `packages` (only Dart
build‑cache binaries match, which are not source).

| Feature | PRD | Pri | Status | Evidence / Gap |
|---|---|---|---|---|
| Dashboard (global FY/quarter/property/agent filter) | §15.3 | P0·ERP | ⛔ Missing | No ERP. Net‑commission / collection / pending / AMC numbers and charts do not exist. |
| Approvals (booking approve/reject + bulk) | §15.3 | P0·ERP | ⛔ Missing | No booking‑approval workflow (webadmin approves listings/KYC, not bookings). |
| Bookings (Ledger) | §15.3 | P0·ERP | ⛔ Missing | No editable ledger, export/import, bulk actions, or historical‑booking entry. (`GET /v1/admin/bookings` is a read‑only search, not a ledger.) |
| Booking detail / KYC | §15.3 | P0·ERP | ⛔ Missing | No combined customer + invoice‑breakdown + commission + document‑zoom screen. |
| Agents (performance, leaderboard, reassignment) | §15.3 | P0·ERP | ⛔ Missing | No agent performance/leaderboard/reassign with recompute. |
| Commission Center (`Net = Commission + Paid‑to‑PG − Collected`) | §15.3 | P0·ERP | ⛔ Missing | No commission model, ledger, mark‑received, or Excel statement. |
| Invoice Center (customer + commission PDFs, send/bulk) | §15.3 | P0·ERP | ⛔ Missing | No invoice model, PDF generation, or WhatsApp send. |
| Money Manager (monthly collection/payouts/balance/drill‑down) | §15.3 | P0·ERP | ⛔ Missing | Not implemented. |
| CA & Compliance (one‑click multi‑sheet Excel pack) | §15.3 | P0·ERP | ⛔ Missing | Not implemented. |
| Settings & Users (team logins, company config, FY) | §15.3 | P0·ERP | ⛔ Missing | Not implemented. (Admin role change exists but is not the ERP team/workspace module.) |

### ⚠️ ERP stack requirement (applies to every §15 item above)

When the ERP is built, it **must be implemented on the existing
`Node 20 + Fastify + Prisma + PostgreSQL` backend and the React/Vite + Flutter
clients in this monorepo — NOT on Supabase or Vercel.** Specifically:

- The §15.5 "one money engine" belongs in shared TypeScript
  (`packages/shared` + a backend service), reusing the existing integer‑paise
  helpers (`packages/shared/src/money.ts`, `backend/src/lib/money.ts`) — not a
  Supabase/Postgres‑function or an external service.
- The §15.8 "two server‑side functions" (WhatsApp send; secure team‑login
  creation) must be **Fastify routes** in `backend/src/modules/**`, **not**
  Supabase Edge Functions or Vercel serverless functions. Team‑login creation
  must reuse the existing auth stack (`modules/auth/`, `AuditLog`).
- ERP persistence must be **Prisma models in `backend/prisma/schema.prisma`**
  against the same Postgres database — not a separate Supabase project.
- The repo currently contains **no Supabase or Vercel references** anywhere
  (grep = 0), so the existing‑stack constraint holds today; this note exists to
  keep it that way.

---

## Appendix — backend endpoints enumerated (evidence base)

```
POST /v1/auth/otp/request   POST /v1/auth/otp/verify   POST /v1/auth/refresh   POST /v1/auth/logout
GET  /v1/me                 PATCH /v1/users/:id/role
GET  /v1/listings           GET  /v1/listings/:id      GET  /v1/listings/search/nearby
POST /v1/listings           PATCH /v1/listings/:id     POST /v1/listings/:id/rooms
POST /v1/listings/:id/rooms/:roomId/beds               POST /v1/listings/:id/photos
GET  /v1/bookings           GET  /v1/bookings/:id       POST /v1/bookings   POST /v1/bookings/:id/payment
PATCH /v1/cash-collections/:id/collect                 PATCH /v1/cash-collections/:id/reconcile
GET  /v1/featured           POST /v1/ads                GET /v1/ads/pending
POST /v1/ads/:id/approve    POST /v1/ads/:id/reject     PUT /v1/ad-pricing/:slotType
GET  /v1/admin/kyc          POST /v1/admin/kyc/:id/approve   POST /v1/admin/kyc/:id/reject
GET  /v1/admin/listings     POST /v1/admin/listings/:id/publish   POST /v1/admin/listings/:id/suspend
GET  /v1/admin/bookings     GET  /v1/admin/payments     GET /v1/admin/cash-collections
GET  /v1/admin/agents/cash-in-hand                      GET /v1/metrics
POST /v1/roomie             POST /v1/webhooks/razorpay  GET /health   GET /health/ready
```

_Audit produced by reading the PRD and the repository only; no application code
was modified._
