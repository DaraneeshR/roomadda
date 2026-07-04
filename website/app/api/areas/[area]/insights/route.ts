import { NextResponse, type NextRequest } from "next/server";
import { callBackend, relayError } from "../../../../../lib/backend";

/**
 * Area price insights — the BFF proxy the client filter histogram / "good value"
 * hints can hit for LIVE data on the same origin (keeping `connect-src 'self'`).
 * Discovery is open, so this only relays the path + query through to the backend's
 * cached, PUBLISHED-only `/v1/areas/:area/insights`.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ area: string }> },
): Promise<NextResponse> {
  const { area } = await params;
  const result = await callBackend(
    `/v1/areas/${encodeURIComponent(area)}/insights${req.nextUrl.search}`,
    { method: "GET", from: req },
  );
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
