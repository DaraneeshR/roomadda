import { NextResponse, type NextRequest } from "next/server";
import { createHotelReservationSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../../lib/backend";

/**
 * List the caller's own hotel reservations (cursor-paginated, newest first). Same
 * data the "confirming…" page polls one of — the backend enforces ownership and
 * the max page size. The browser calls this same-origin route with its in-memory
 * access token; the token/refresh cookie never leaves this origin.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await callBackend(`/v1/hotels/reservations${req.nextUrl.search}`, { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}

/**
 * Hold a hotel room for a date range — the first step of the web hotel flow. The
 * client sends ONLY { categoryId, checkIn, checkOut, guests } (`.strict()` rejects
 * any price field): nights, the per-night snapshot, and the token are computed and
 * owned by the backend, which also enforces TENANT + VERIFIED KYC (requireKyc) and
 * the row-locked overbooking guard. This layer only validates the shape and relays.
 *
 * NEVER confirms anything: a fresh hold is HELD. Confirmation is owned by the
 * signature-verified webhook alone (see /CLAUDE.md domain rule #2).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = createHotelReservationSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await callBackend("/v1/hotels/reservations", { method: "POST", json: body, bearer, from: req });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}
