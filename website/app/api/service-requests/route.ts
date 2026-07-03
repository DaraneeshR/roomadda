import { NextResponse, type NextRequest } from "next/server";
import { createServiceRequestSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../lib/backend";

/**
 * Maintenance / service requests against the caller's active stay. GET lists the
 * caller's own tickets (cursor-paginated); POST raises a new one (the backend
 * resolves which stay it belongs to and requires an active stay). Same endpoints
 * the app uses.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await callBackend(`/v1/service-requests${req.nextUrl.search}`, { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = createServiceRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await callBackend("/v1/service-requests", { method: "POST", json: body, bearer, from: req });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}
