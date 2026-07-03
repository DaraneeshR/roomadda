import { type NextRequest, type NextResponse } from "next/server";
import { upsertMealMenuSchema } from "@roomadda/shared";
import { proxyGet, proxyMutation, seg } from "../../../../../../lib/hostBff";

/**
 * Read the listing's menu (today + tomorrow) — the same read the tenant sees, so
 * the host previews exactly what tenants get. Reads carry no masked data (just
 * dish text).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyGet(req, `/v1/listings/${seg(id)}/menu${req.nextUrl.search}`);
}

/** Write one day's menu (today or tomorrow) — pushes a silent update to tenants. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "PUT", `/v1/host/listings/${seg(id)}/menu`, upsertMealMenuSchema);
}
