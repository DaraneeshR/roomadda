import { type NextRequest, type NextResponse } from "next/server";
import { createEmployeeSchema } from "@roomadda/shared";
import { proxyGet, proxyMutation } from "../../../../lib/hostBff";

/** The company's employee directory (own company only, cursor-paginated). */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, `/v1/corporate/employees${req.nextUrl.search}`);
}

/** Add an employee directory entry (company ADMIN seat; JIT-linked by phone). */
export function POST(req: NextRequest): Promise<NextResponse> {
  return proxyMutation(req, "POST", "/v1/corporate/employees", createEmployeeSchema, 201);
}
