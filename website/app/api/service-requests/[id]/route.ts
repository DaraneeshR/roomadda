import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../lib/backend";

/** One of the caller's own tickets (status + comment thread). 404 if foreign. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const result = await callBackend(`/v1/service-requests/${encodeURIComponent(id)}`, {
    method: "GET",
    bearer,
    from: req,
  });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
