# Handoff: RoomAdda — PG Accommodation Platform (MVP v1)

## Overview
RoomAdda is a **PG (Paying Guest) accommodation platform** for students and working professionals in India. It is **not** a real estate / property-sales product — keep the vocabulary consistent everywhere: **tenants** (not buyers), **hosts** (not sellers), **monthly rent** (not price), **token** (not down payment), **move-in date** (not possession).

The product is **one mobile app with a role chooser** (Tenant / Host / Agent) plus a **web Admin console** and a **public marketing/booking website**. The North Star: *a user finds a verified PG, pays a token, and confirms a booking end-to-end in under 5 minutes, on their phone.*

This bundle contains the full v1 design as an interactive HTML board covering **5 surfaces / 65 screens**:
1. **Tenant App** (mobile)
2. **Host App** (mobile)
3. **Agent App** (mobile)
4. **Admin Dashboard** (web, 1440px)
5. **Marketing + booking Website** (web, 1440px)

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing the intended look, layout, copy, and click-flow. **They are not production code to copy directly.** Your task is to **recreate these designs in the target codebase using its established patterns and libraries.**

Per the product's own tech plan the intended stack is:
- **Mobile apps:** React Native (Expo) — Tenant, Host, Agent
- **Admin + Website:** React.js / Next.js (SSR for SEO) + Tailwind CSS
- **Backend:** Node.js + Express, **PostgreSQL** (single source of truth), Redis cache
- **Integrations:** Razorpay (payments), MSG91/Twilio (OTP SMS), Google Maps + Places, WhatsApp Business API (booking notifications), AWS S3 (document/photo storage), DigiLocker (Aadhaar KYC), Firebase (push + dynamic/deferred deep links)

If you build mobile in React Native, treat the 390×844 frames as iPhone-class layouts (44px min hit targets). The web frames are designed at 1440px wide and should be made responsive.

> **Golden rule (from the spec):** Website, user app, host app and admin panel are **four clients of one backend/one database**. There is never a "web price" and an "app price" — one `room_types` record, served to whoever asks. A host edits rent once; it's instantly true everywhere (bust the Redis key; push a live "price updated" event to open sessions).

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, component styling and copy are all intentional — recreate the UI faithfully using the codebase's component library. Exact tokens are in the **Design Tokens** section. Imagery uses gradient placeholders (real photos to be supplied); icons are **Phosphor Icons** (regular / bold / fill weights).

---

## Design Tokens

### Color
| Token | Hex | Use |
|---|---|---|
| Ink | `#1C1A17` | Primary text, dark surfaces, primary buttons on light |
| Paper | `#FBF9F5` | Default light screen background |
| Paper-alt | `#F4F1EB` | Secondary background (cards-on-cards, chips) |
| Card | `#FFFFFF` | Cards, sheets |
| Red (primary accent) | `#D6483B` | Primary CTAs, active state, brand dot, price |
| Red wash | `#FBEDEB` | Red-tinted chips / soft fills |
| Verified green | `#2F8A5B` | Verified badges, success, positive deltas |
| Green wash | `#E9F4EE` | Green chip backgrounds |
| Amber | `#C9892E` | Warning / pending / "in review" |
| Amber wash | `#FBF3E8` | Amber chip backgrounds |
| Blue (info) | `#3A5B8A` | Info, internet/utility icons, agent accents |
| Blue wash | `#EEF1F6` | Blue chip backgrounds |
| Muted text | `#6B655C` | Secondary text |
| Faint text | `#9A938A` | Tertiary text, placeholders |
| Hairline | `#ECE7DE` / `#E4DED4` | Borders, dividers |
| Agent green hero | `#2F8A5B`→`#247048` | Agent gradient surfaces |

Section accent chips (board only): Tenant red `#D6483B`, Host ink `#1C1A17`, Agent green `#2F8A5B`, Admin blue `#3A5B8A`.

### Typography
- **Primary family:** `Plus Jakarta Sans` (weights 400/500/600/700/800).
- **Mono / labels:** `JetBrains Mono` (500) — used for eyebrow labels, screen codes, the "Stay · Grow · Belong" tagline, transaction IDs.
- Scale in use: display 40–64px/800; H1 22–30px/800; H2 19–21px/800; body 14–17px/400–500; labels 11–13px; letter-spacing −0.02 to −0.035em on large headings, +0.1 to +0.22em on mono eyebrows.

### Spacing / radius / shadow
- Spacing rhythm: 6 / 9 / 12 / 14 / 18 / 22 / 24 / 32 / 48px.
- Radius: chips/pills `999px`; inputs/small `11–15px`; cards `16–22px`; sheets/large `24–32px`; phone bezel `46px`; phone notch `20px`.
- Card shadow (light): `0 1px 2px rgba(28,26,23,.04), 0 0 0 1px rgba(28,26,23,.05)`.
- Elevated/sheet: `0 8px 24px -14px rgba(28,26,23,.18)`.
- Primary-button glow: `0 12px 26px -10px rgba(214,72,59,.6)`.
- Phone frame: `0 50px 90px -28px rgba(28,26,23,.42), 0 12px 30px -16px rgba(28,26,23,.2), 0 0 0 1px rgba(28,26,23,.06)`.

### Components (recurring)
- **Primary button:** bg `#D6483B`, text `#fff`, 700/16px, padding 16–17px, radius 15px, glow shadow.
- **Secondary button:** bg `#fff`, text `#1C1A17`, inset ring `0 0 0 1.5px #E4DED4`.
- **Dark button:** bg `#1C1A17`, text `#F7F4EE`.
- **Badge (verified):** green wash pill, `seal-check` fill icon + label, 700/11px.
- **Badge (featured/urgent):** red wash pill, `star`/`warning` icon.
- **Status chips:** Paid=green wash, Overdue/Urgent=red wash, Pending/Notice=amber wash.
- **Phone status bar:** 54px tall, "9:41" + cell/wifi/battery fill icons; centered notch pill.
- **Bottom tab bar (tenant):** 84px, blurred bg, 5 tabs Home/Search/Bookings/Saved/Profile; active = red fill icon + 700 label.

---

## Surfaces, screens & flows

Each screen on the board carries a code badge (e.g. `TEN-04`). Codes map to the MVP Plan sections. `PLT-*` = platform/shared.

### 0. Entry & access control
- **App Entry / role chooser (PLT-00):** dark welcome; three role cards — *Find a PG* (tenant), *List & manage my PG* (host), *I'm a field agent* (agent) — plus *Admin console — open on web*. Routes each role to its surface. In production, role is stored per account and remembered; the picker shows on first launch or multi-role accounts.
- **Host access gate (HST-13) & Agent access gate (AGT-08):** Registration only **submits an application**. The dashboard is **locked behind admin approval** (host: identity ✓ → bank ✓ → ownership check in review → dashboard locked; agent: identity ✓ → background check → zone assignment → tasks/cash permission locked). **Enforce server-side**: a non-owner / non-agent never gets `approved=true`, so the dashboard is never served. Declined applications show a reason and never unlock.

### 1. Tenant App (mobile, 390×844)
Onboarding: **Sign-up & login** (mobile OTP, 60s resend, Google sign-in still requires mobile for WhatsApp; biometric after first login; 30-day session) · **Profile Setup** (name, photo, gender [used only for gender-filter matching, never shown to hosts], DOB, city, occupation → student=college/city or professional=company/location; completion progress; required before booking) · **Just-in-time KYC** (Aadhaar + supporting ID; statuses Not submitted/Pending/Verified/Rejected; **payment blocked until Verified**; encrypted, admin-only).

Discovery: **Smart Search / Home** (Places autocomplete: locality/landmark/college/metro/company; Near Me; recent searches) · **Results List + Filters** (rent slider ₹3k–30k, room type, gender, meals, amenities multi-select, furnishing, verified-only, move-in date; chips; sorts; infinite scroll 15/page; skeletons; featured pinned top-2) · **Map View** (Google Maps pins, clustering, price pins, mini-card, "search this area") · **PG Detail** (swipeable gallery, room-wise pricing table, amenities, house rules, meals, host card *without phone number*, map embed, sticky Book/Wishlist).

Booking: **Confirm & pay token** (room type, move-in date picker [blocks past/booked], meal plan, summary distinguishing token-paid-now vs monthly rent, cancellation policy; Instant Book vs 24h host approval) · **Token paid / confirmation** (Razorpay UPI/card/netbanking; 10-min timeout; success = Booking ID + address + host + move-in; WhatsApp to user + push to host; downloadable PDF; token adjusts into first rent) · **My Bookings** (Active/Pending/Past tabs; statuses Pending Host Approval / Payment Pending / Confirmed / Active Stay / Completed / Cancelled; real-time status) · **Wishlist / Saved** (persists across devices; live Available/Full; price-drop & new-room push).

Post move-in: **Stay Dashboard** (activates automatically on move-in date; PG/room/rent/next-due, SOS always visible, quick actions Pay Rent/Raise Request/View Menu/Chat) · **Daily Meal Menu** (today + tomorrow; "not updated yet" w/ timestamp) · **Pay Monthly Rent** (status Paid/Due/Overdue; Razorpay prefilled; full month only, no partial; receipts) · **Service Request** (category, description, priority, ≤3 photos; ticket #; Submitted→Acknowledged→Resolved; urgent auto-escalates to admin in 4h; resolved → 1–5★) · **Leave Notice** (move-out date ≥ notice period; can't withdraw within 3 days; queues room "Vacating Soon"; deposit estimate) · **In-app Chat** (tenant↔host, text+photo, real-time, typing indicator, no phone numbers, admin-visible) · **Notices from Host** (broadcast inbox) · **Notifications Inbox** · **Rate Your Stay** · **Profile & Settings** · **SOS & Trusted Contacts** (1–3 contacts; SOS within 2 taps shares GPS via SMS + alerts admin; SMS fallback).

### 2. Host App (mobile, 390×844)
**Host Registration & KYC** (mobile OTP, Aadhaar/PAN, ownership proof; → access gate) · **Guided Listing creation** (7-step: basics, location, room types & pricing, amenities, photos, rules, meals) · **Inventory & Free Beds** (per-room-type free-bed steppers, show-online toggle) · **Booking Request Management** (approve within 24h; approval locks room 4h for token) · **Tenant Roster** (current/vacating/past; rent status; chat; *tenant ID docs never shown to host*) · **Walk-in Entry** (offline bookings) · **Meal Menu Editor** · **Service Request Queue** (urgent/open/resolved; acknowledge/resolve) · **Broadcast to Tenants** (≤280 chars, ≤3/day, current tenants only) + **Broadcast Preview/Confirm** · **Promote my PG** (featured, admin-approved) · **Earnings Dashboard** (collected/expected/overdue, occupancy, rooms).

### 3. Agent App (mobile, 390×844)
**Onboarding & Registration** (Aadhaar+PAN, preferred zone; → access gate; cash permission admin-granted) · **Today's Tasks** (visits/bookings/on-time) · **GPS Check-in** (assignment + geofenced check-in) · **Inspection Checklist** (8 checks, photo-required items, approve/reject recommendation) · **Assisted Booking & Cash** (on-ground conversion) · **Cash-in-hand & Remittance** · **Performance Summary** (commission, visits, closes).

### 4. Admin Dashboard (web, 1440×900)
Left sidebar nav (Operations) + topbar (search, date range, notifications). **Admin Login & 2FA** (staff-only, audit-logged) · **Platform Overview** (KPI cards: tenants, live listings, bookings 30d, GMV; bookings/revenue chart; "pending your action": listings/KYC/escalations) · **Listing Moderation** (approval queue, agent reports) · **KYC Management** (document viewer, approve/reject w/ reason) · **User / Host / Agent Management** + **Host Detail** (profile, verification, performance, listings) · **Service-request Oversight & Escalations** (SLA) · **Notification & Push Manager** · **Payment & Cash Reconciliation** · **Ads & Pricing Management** · **Agent Zones & Cash Permissions** · **Append-only Audit Log** · **Website Control**. **Hard rule: Admin has NO booking capability** — oversight/governance only.

### 5. Website (web, 1440px, Next.js SSR for SEO)
**Marketing Home & Featured front page** · **Browse & Discover** (masked listings until token; full filter system) · **Roomie — AI Assistant** · **For Hosts (marketing)** · **Web Login & Sign-up** · **Tenant Web Account** · **Host Web Console** · **About & Contact**. Booking model: *web supports the full booking + token flow (no forced install)*; high-intent moments promote the app via deep links / QR. Universal links + Firebase deferred deep links carry web context into the app.

---

## Interactions & behavior (prototype wiring)
The board is click-wired to demonstrate flows: tapping a CTA / tab / card smooth-scrolls to the target screen and pulses a red highlight. Key tenant chain: **App Entry → Sign-up → Profile Setup → Smart Search → Results ⇄ Map → PG Detail → Confirm → KYC → Token paid → My Bookings / Stay Dashboard**, with Stay Dashboard quick-actions → Pay Rent / Meals / Service / Chat / Leave / SOS, and bottom tabs wired. Host/Agent entry → Registration → **access gate** → (only if approved) Dashboard. Treat all of this as **intended navigation**, not final routing — implement with the app's router + real auth/role guards. (The wiring is implemented in the DC's logic class as a reference only.)

Animation/transition intent: gentle (≈300–480ms ease-out) scroll/transition; no aggressive motion. Buttons: subtle press; cards: hover elevation on web.

## State management (per client)
- **Auth/session:** phone OTP, Google link-merge by mobile, biometric flag, 30-day session, **role + approval status** (gates host/agent dashboards).
- **Profile completion %**, KYC status enum.
- **Search:** query, geo, radius, filter object, sort, results page, recent searches (local).
- **Booking:** selected room type, move-in date, meal plan, instant-vs-approval, payment session (10-min TTL), booking status enum.
- **Stay:** active-stay flag (triggered by move-in date), rent status, service tickets, chat threads, leave-notice status.
- **Host:** inventory (free beds per room type), booking requests, roster, broadcasts/day counter (≤3).
- **Agent:** task list, check-in geofence, checklist progress, cash-in-hand balance.
- **Real-time:** push/WebSocket for booking status, price updates, broadcasts, chat.
All booking/availability rules enforced **server-side**; double-booking prevented at the DB.

## Assets
- **Logo:** `assets/roomadda-logo.jpg` (wordmark — black/white with red accent; in UI rendered as the text wordmark "RoomAdda" + red period). Recreate as text where possible; use the file for the marketing logomark.
- **Icons:** Phosphor Icons (`@phosphor-icons/web` regular/bold/fill). Swap for the codebase's icon lib if it has equivalents.
- **Fonts:** Plus Jakarta Sans + JetBrains Mono (Google Fonts).
- **Photography:** gradient placeholders in the mock — replace with real verified-PG photos.

## Files in this bundle
- `RoomAdda Design.dc.html` — the full interactive design board (source of truth). Open in a browser.
- `RoomAdda Design (standalone).html` — self-contained offline version (all assets inlined).
- `support.js` — runtime for the .dc.html (needed to open the source file locally).
- `assets/roomadda-logo.jpg` — logo.
- `reference/Roomadda_MVP_Plan.html` — the full MVP product spec (features, acceptance criteria, rules, timeline).
- `reference/Roomadda_Website_Master_Blueprint.html` — full-product website spec (mostly **post-MVP**: web property detail, web booking, trust tags, compare/"mind" features, Roomie AI).

## Scope note for the build
The **MVP** = everything in surfaces 1–4 above + the promotional website pages. The Website Blueprint v3.0's deeper commerce features (full web property-detail + web booking, trust-tag system, live social proof, compare / cost-of-living "mind" features) are **explicitly post-MVP** by that document's own framing — build after MVP validation unless re-prioritized.

Recommended build order: **Tenant booking flow first** (the North Star), then Host listing/inventory, then Agent verification, then Admin, then website.
