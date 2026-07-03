import { NextResponse, type NextRequest } from "next/server";
import { callBackend, relayError } from "../../../../lib/backend";

/**
 * Nearby search proxy for the split-view map's "search this area" action. Takes
 * `lat`/`lng`/`radiusM` (validated by the backend) and relays the masked results
 * with their bucketed `distanceMeters`. Public — discovery needs no auth.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await callBackend(`/v1/listings/search/nearby${req.nextUrl.search}`, { method: "GET", from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
