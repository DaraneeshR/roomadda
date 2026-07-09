import { type NextRequest, type NextResponse } from "next/server";
import { createEnquirySchema } from "@roomadda/shared";
import { proxyGet, proxyMutation } from "../../../../lib/hostBff";

/** The company's own enquiries (cursor-paginated, newest first). */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, `/v1/corporate/enquiries${req.nextUrl.search}`);
}

/** Raise a new enquiry (dates / location / headcount / property type). No money. */
export function POST(req: NextRequest): Promise<NextResponse> {
  return proxyMutation(req, "POST", "/v1/corporate/enquiries", createEnquirySchema, 201);
}
