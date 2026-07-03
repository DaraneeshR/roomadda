import { NextResponse, type NextRequest } from "next/server";
import { createLeaveNoticeSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../lib/backend";

/**
 * Leave notices for the caller's active stay. GET returns the caller's notices
 * plus the policy the form needs (notice period + earliest move-out date). POST
 * serves notice; the notice-period rule is enforced server-side.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await callBackend("/v1/leave-notices", { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = createLeaveNoticeSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // coerce.date() yields a Date; serialize as ISO for the JSON hop to the backend.
  const payload = { moveOutDate: (body as { moveOutDate: Date }).moveOutDate.toISOString() };
  const result = await callBackend("/v1/leave-notices", { method: "POST", json: payload, bearer, from: req });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}
