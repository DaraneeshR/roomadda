import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet } from "../../../../lib/hostBff";

/** The company's own invoices (engine-sourced totals; balance derived server-side). */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, `/v1/corporate/invoices${req.nextUrl.search}`);
}
