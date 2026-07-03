import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../../../lib/backend";
import { seg } from "../../../../../../lib/hostBff";

/**
 * Submit a listing to the ADMIN review queue — this is how a host "publishes"
 * from the web: it moves the listing to PENDING_REVIEW, never straight to
 * PUBLISHED. Going live is the admin's decision after review (and their publish
 * path re-checks the §9.2 go-live gate: ≥5 photos, VERIFIED host KYC, a priced
 * room). The body is server-fixed so the client can never smuggle another status.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const result = await callBackend(`/v1/listings/${seg(id)}`, {
    method: "PATCH",
    json: { status: "PENDING_REVIEW" },
    bearer,
    from: req,
  });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
