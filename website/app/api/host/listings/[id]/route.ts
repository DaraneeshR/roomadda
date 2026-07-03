import { type NextRequest, type NextResponse } from "next/server";
import { updateHostListingSchema } from "@roomadda/shared";
import { proxyGet, proxyMutation, seg } from "../../../../../lib/hostBff";

type Ctx = { params: Promise<{ id: string }> };

/** Full host view of one listing (unmasked + per-room inventory rollup). */
export async function GET(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  return proxyGet(req, `/v1/host/listings/${seg(id)}`);
}

/**
 * Edit host-managed listing fields. The backend classifies the change: an
 * address edit re-queues a LIVE listing for approval (the response carries
 * `requeued` + `changedFields`); minor edits go live immediately.
 */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "PATCH", `/v1/host/listings/${seg(id)}`, updateHostListingSchema);
}
