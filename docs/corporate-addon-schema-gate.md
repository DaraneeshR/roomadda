# Corporate (B2B) add-on — data-model foundation (C0 schema gate)

**Status:** schema + migration + corporate-visibility invariant + employee-privacy
invariant landed and proven. **No quotation flow, invoicing, or portal in this gate**
— those are C1 (backend flow) and C2 (portals). C0 is the entity model + the two
structural invariants only.

**Scope built (C0):** the corporate entity model —
`Company` → `CompanyUser` (HR/admin seats) + `Employee` (directory) — plus the
sales-pipeline skeleton `CorporateEnquiry` → `Quotation` (+ `QuotationRevision` +
`QuotationLineItem`) → `CorporateBooking` (+ `EmployeeAllocation`) → `CorporateInvoice`
(structure only). Everything **reuses** rather than forks: the H0 listing
`visibility` (`CORPORATE_ONLY`/`BOTH`) for distribution, the H0 hotel inventory +
overbooking guard for the actual corporate stays (`channel = CORPORATE` units), the
ERP money-engine pattern (integer paise; store only non-derivable figures), and the
single-identity phone rule for linking an `Employee` to a consumer `User`. Migration
via `migrate diff --from-migrations` + `migrate deploy` (never `migrate dev`);
PostGIS + the hotel/booking guards are untouched.

---

## Schema-affecting OPEN QUESTIONS — surfaced for sign-off

The PRD tags the "Corporate tie-up portal" as **POST-MVP, "B2B feature — separate
roadmap"** (`docs/PRD_COVERAGE.md`, `Roomadda_MVP_Plan.html §…`) and gives it **no
schema spec**. So the money/terms questions below were genuinely open. They were put
to the product owner and **signed off** on the recommended (minimal-safe) option, the
same way the Hotel gate handled its three. If any assumption is wrong, the model
changes — re-open before relying on it.

| # | Open question | **Signed-off decision** | If it changes… |
|---|---------------|-------------------------|----------------|
| 1 | **Billing / credit terms** — net-30 credit invoice after the stay, or prepay? | **Model BOTH; per-company default set by an admin.** `Company.billingMode` ∈ `{PREPAY, CREDIT}` with `creditDays` (default **30**). PREPAY = webhook-truth exactly like B2C; CREDIT = a `CorporateInvoice` issued **post-stay**, `status` `DUE`/`PAID`/`OVERDUE`, `dueDate = issuedAt + creditDays`. This is a **superset** — C1 explicitly needs both paths — so no rework if a company negotiates the other term. | Nothing structural; it is a per-row mode, not a schema fork. Adding a third term (e.g. milestone billing) would add an enum value + columns. |
| 2 | **Quotation shape** — versioned with revisions, or a single editable record? | **Versioned, append-only.** A `Quotation` is a container; its terms + line items live on a `QuotationRevision` (1-based `revision`). A `NEGOTIATING` round creates the **next** revision — earlier revisions are **never** mutated, so the full negotiation history is preserved and auditable. `Quotation.currentRevision` points at the in-force one. | Collapsing to a single record would drop history; not recommended once a quote is legally sent. |
| 3 | **Employee ↔ consumer identity** — link to an existing consumer `User` by phone (single-identity merge), or a separate directory record? | **Directory record with a JIT link by phone.** `Employee` is a company-scoped directory row (`fullName`, `phone`, `email?`), unique per `(companyId, phone)`. `Employee.userId` links the consumer `User` **when one with that phone exists / registers** — the same single-identity phone rule the website auth BFF already uses (same-phone merge). The `Employee` carries **NO** pricing / rate / finance field (privacy is structural). | If HR must manage identities that never become app users, the directory already stands alone (the `userId` link is optional). |

### Other forced assumptions (documented, not guessed)

- **Corporate stays reuse the hotel inventory.** A `CorporateBooking` draws
  `HotelReservation` rows on the **`CORPORATE`-channel** `HotelRoom` units carved out
  by H0's `corporateReservedRooms`, so the **existing GiST overbooking guard makes an
  overlapping double-book impossible** with zero new inventory code. (Whole-PG or FLAT
  corporate stays are out of scope; `CorporateEnquiry.propertyType` defaults `HOTEL`.)
- **`CorporateInvoice` is company-level and references bookings.** In this gate it
  aggregates **one** `CorporateBooking` (`corporateBookingId` nullable so multi-booking
  aggregation can arrive later without a migration). Money-movement refs
  (Razorpay/webhook/settled-by) are **added in C1**, not here — C0 has terms + status
  columns only.
- **Tax.** Quotation/invoice totals carry a `taxPaise` column (GST), defaulted `0` in
  this gate; the actual GST computation is an ERP-engine concern wired in C1. All money
  is integer paise via the shared helpers — never floats, never ad-hoc arithmetic.

---

## The two C0 invariants (server-side, wired now)

### 1. Corporate visibility (extends the H0 filter — both directions)

`modules/listing/visibility.ts` is unchanged and already **bidirectional**: its two
audiences are disjoint on the `*_ONLY` values —

- `visibleVisibilities("B2C")` → `USER_ONLY | BOTH`
- `visibleVisibilities("CORPORATE")` → `CORPORATE_ONLY | BOTH`

H0 only *wired* the B2C side. C0 wires the **corporate** side: the new
`corporateService.listCorporateInventory` folds in `visibilityWhere("CORPORATE")`, so a
`CORPORATE_ONLY` listing **is reachable in a corporate context AND never appears in a
B2C response** — proven in both directions by `corporate.integration.test.ts`. Existing
PG listings default `USER_ONLY`, so B2C is a no-op for them (unchanged).

### 2. Employee privacy (structural)

An employee-scoped read exposes **only** the employee's own stay (dates, room tier, and
the check-in QR once confirmed) — **never** a negotiated rate, company finance, another
employee, or owner payouts. This is **structural, not filtered**:
`corporate.employee.ts` selects a fixed safe column set and imports **no** pricing /
finance module. Negotiated money lives exclusively on `Quotation` / `QuotationRevision`
/ `CorporateBooking` / `CorporateInvoice`, which the employee path never touches. Proven
both directions in the test (the safe fields are present; rate/finance/other-employee
data is absent).

---

## Byte-for-byte existing-behaviour safety

- Every new corporate table is additive; the only change to an existing table is
  **nullable** columns on `hotel_reservations` (`corporateBookingId`) — existing rows
  and the B2C hotel flow are untouched.
- No existing enum, column default, or serializer changed. PG + B2C-hotel paths are
  unaffected (asserted by the full integration suite staying green — no regression).
- The PostGIS geography column/trigger (`01_postgis.sql`), the bed guard
  (`02_booking_guard.sql`), and the hotel guard (`03_hotel_guard.sql`) are re-applied
  unchanged by `pnpm db:sql`.

## Follow-ups (out of this gate)

- **C1 (backend flow):** ✅ **DONE** — enquiry intake → quotation build/negotiate/accept
  → corporate booking drawing corporate inventory (H0 guard) → employee allocation →
  company invoice via the shared corporate money engine (`packages/shared/src/corporate.pricing.ts`);
  Razorpay/webhook money-movement columns on `CorporateInvoice` (migration
  `20260709000000_corporate_flow_invoice_payment`); webhook order-routing branch
  (`markCorporateInvoicePaidByOrder`). PREPAY confirms via the verified webhook; CREDIT
  is CRM-confirmed then settled online (webhook) or offline (admin-marked, audited).
  Proven in `corporate.flow.integration.test.ts`.
- **C2 (portals):** ✅ **DONE** — the HR/company Corporate Dashboard (`website/app/corporate/*`
  over `/api/corporate/*` BFF) and the admin Corporate CRM/finance pages
  (`webadmin/src/pages/Corporate*` under the "Corporate" nav section). Money is
  display-only on both (read the engine-sourced DTO, never compute); online invoice
  payment polls to PAID (webhook-truth).

## Where the pieces live (built)

- **Backend:** `backend/src/modules/corporate/` (access/enquiry/quotation/booking/invoice
  services + routes + serializer + webhook branch + integration tests);
  visibility read `corporate.inventory.service.ts`; employee-privacy read
  `corporate.employee.ts`.
- **Shared:** corporate enums + DTOs in `contracts.ts`, request schemas in `requests.ts`,
  the pure money engine in `corporate.pricing.ts`.
- **Migrations:** `20260708000000_corporate_addon_foundation` (C0),
  `20260709000000_corporate_flow_invoice_payment` (C1).
