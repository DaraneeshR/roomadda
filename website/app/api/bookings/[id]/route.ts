import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../lib/backend";

/**
 * Read one of the caller's own bookings. The web "confirming…" screen polls THIS
 * to observe the webhook-driven transition to CONFIRMED — exactly like the app
 * (see /CLAUDE.md domain rule #2). Ownership is enforced by the backend: another
 * tenant's id is a 404 (never 403), so the id can't be probed.
 *
 * The returned BookingDetail carries the MASKED listing (and no host name) until
 * CONFIRMED, then the unmasked private listing + host name — the reveal is
 * server-side in the serializer, never trusted from the client.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const result = await callBackend(`/v1/bookings/${encodeURIComponent(id)}`, {
    method: "GET",
    bearer,
    from: req,
  });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
