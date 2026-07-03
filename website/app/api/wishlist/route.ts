import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../lib/backend";

/**
 * The caller's saved listings (masked, cursor-paginated). The SAME rows back the
 * app and this web account — one wishlist per phone-keyed identity (see
 * /CLAUDE.md), so a heart toggled on the web shows in the app and vice-versa.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await callBackend(`/v1/wishlist${req.nextUrl.search}`, { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
