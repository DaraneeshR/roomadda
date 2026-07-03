import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../lib/backend";

/**
 * The caller's own rent history (cursor-paginated, newest due first). The first
 * row is the current invoice the "Pay Rent" card reads. Same data as the app;
 * amounts are server-owned integer paise — the web never computes them.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await callBackend(`/v1/rent${req.nextUrl.search}`, { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
