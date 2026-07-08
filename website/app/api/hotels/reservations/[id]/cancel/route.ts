import { NextResponse, type NextRequest } from "next/server";
import { cancelBookingSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../../../../lib/backend";

/**
 * Cancel one of the caller's own hotel reservations. The backend computes the
 * refund per policy and INITIATES it; the refund SETTLES only via the verified
 * refund webhook, so the response reports refundStatus PENDING — the client never
 * settles money (see /CLAUDE.md domain rule #2). The optional `reason` is the only
 * accepted field (`.strict()` rejects anything else).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    // Body is optional; default to {} so a bare cancel validates.
    body = cancelBookingSchema.parse((await req.json().catch(() => ({}))) ?? {});
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await params;
  const result = await callBackend(`/v1/hotels/reservations/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    json: body,
    bearer,
    from: req,
  });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
