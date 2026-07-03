import { type NextRequest, type NextResponse } from "next/server";
import { createWalkInSchema } from "@roomadda/shared";
import { proxyGet, proxyMutation, seg } from "../../../../../../lib/hostBff";

/** List walk-in tenants recorded on this listing (current by default). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyGet(req, `/v1/host/listings/${seg(id)}/walk-ins${req.nextUrl.search}`);
}

/**
 * Record a walk-in tenant — blocks a bed and fires the app-invite SMS. The typed
 * Aadhaar number is stored server-side for the host's record only and is never
 * returned in full (only the last 4 digits come back).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/host/listings/${seg(id)}/walk-ins`, createWalkInSchema, 201);
}
