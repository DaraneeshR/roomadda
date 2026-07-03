import { NextResponse, type NextRequest } from "next/server";
import { createBookingSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../lib/backend";

/**
 * List the caller's own bookings (cursor-paginated, newest first) — the "My
 * Bookings" page. Identical data to the app: each item is the same BookingDetail
 * (masked until CONFIRMED, then unmasked + host name). Cursor/limit are forwarded
 * verbatim; the backend enforces the max page size.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await callBackend(`/v1/bookings${req.nextUrl.search}`, { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}

/**
 * Place a booking hold — the first step of the web booking flow. The browser
 * calls THIS same-origin route (never the backend directly), which forwards the
 * caller's in-memory access token as a bearer. The backend enforces the real
 * rules (TENANT role + VERIFIED KYC via requireKyc, bed row-lock, server-owned
 * token). This layer only validates the shape and relays.
 *
 * NEVER confirms anything: a hold is TOKEN_PENDING (Instant Book) or
 * PENDING_APPROVAL (Request-to-Book). Confirmation is owned by the verified
 * webhook alone (see /CLAUDE.md domain rule #2).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = createBookingSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await callBackend("/v1/bookings", { method: "POST", json: body, bearer, from: req });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}
