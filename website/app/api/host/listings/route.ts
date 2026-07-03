import { type NextRequest, type NextResponse } from "next/server";
import { createListingSchema } from "@roomadda/shared";
import { proxyGet, proxyMutation } from "../../../../lib/hostBff";

/**
 * The host's own listings (live / draft / paused), cursor-paginated. The backend
 * scopes by hostId — a host only ever sees their OWN properties.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, `/v1/host/listings${req.nextUrl.search}`);
}

/**
 * Create a new listing. It is born a DRAFT — never live: going live is the
 * admin's decision after the host submits for review (see the submit route).
 */
export function POST(req: NextRequest): Promise<NextResponse> {
  return proxyMutation(req, "POST", "/v1/listings", createListingSchema, 201);
}
