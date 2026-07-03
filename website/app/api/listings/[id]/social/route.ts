import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../../lib/backend";

/**
 * Honesty-gated social proof for a listing (GET) and the "viewing now" presence
 * heartbeat (POST). Both are public. The GET returns a possibly-empty `social`
 * object — every present field cleared its server-side floor; the client renders
 * exactly what is there and can never fabricate a signal. The POST relays the
 * heartbeat, forwarding the caller's bearer when signed in so the backend dedupes
 * that viewer by user id (anonymous viewers dedupe by the `sessionId` they send).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const result = await callBackend(`/v1/listings/${encodeURIComponent(id)}/social`, { method: "GET", from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const result = await callBackend(`/v1/listings/${encodeURIComponent(id)}/social/heartbeat`, {
    method: "POST",
    json,
    bearer: bearerFrom(req),
    from: req,
  });
  if (result.status !== 204) return relayError(result);
  return new NextResponse(null, { status: 204 });
}
