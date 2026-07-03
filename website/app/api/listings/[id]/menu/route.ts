import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../../lib/backend";

/**
 * The meal menu (today + tomorrow) for a listing. Requires an authenticated
 * tenant/host/admin (the menu carries no masked data, just dish text). The
 * dashboard reads it for the tenant's active-stay listing when meals are offered.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const result = await callBackend(`/v1/listings/${encodeURIComponent(id)}/menu${req.nextUrl.search}`, {
    method: "GET",
    bearer,
    from: req,
  });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
