import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet } from "../../../../lib/hostBff";

/** The company's own quotations with full revision history (cursor-paginated). */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, `/v1/corporate/quotations${req.nextUrl.search}`);
}
