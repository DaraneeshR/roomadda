import { NextResponse, type NextRequest } from "next/server";
import { callBackend, relayError } from "../../../../../lib/backend";

/**
 * A listing's public reviews (newest first, cursor-paginated) + the aggregate
 * summary. Public read — the reviews screen and the "load more" control on the
 * detail page fetch through here so the client never talks to the backend
 * directly (CSP `connect-src 'self'`).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const result = await callBackend(
    `/v1/listings/${encodeURIComponent(id)}/reviews${req.nextUrl.search}`,
    { method: "GET", from: req },
  );
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
