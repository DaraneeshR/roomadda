import { NextResponse, type NextRequest } from "next/server";
import { proxyGet, seg } from "../../../../../lib/hostBff";

/** One of the caller's own quotations, with its full revision history. The backend
 *  scopes to the caller's company — a foreign quotation is a 404. */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return params.then(({ id }) => proxyGet(req, `/v1/corporate/quotations/${seg(id)}`));
}
