import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../lib/backend";

/**
 * The caller's current active stay — their CONFIRMED booking once move-in has
 * arrived. Drives the post-move-in tenant dashboard. Returns
 * `{ activeStay: null }` before move-in or when there is no stay. Same endpoint
 * the app dashboard reads; the real PG name + host emergency contact are allowed
 * here (a CONFIRMED tenant on this listing) — the backend serializer decides.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await callBackend("/v1/me/active-stay", { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
