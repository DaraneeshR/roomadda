import { NextResponse, type NextRequest } from "next/server";
import { updateProfileSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../lib/backend";

/**
 * The caller's own profile, proxied with the in-memory access token. PATCH is how
 * a new web user supplies their name + gender (needed for PG matching) right
 * after OTP verification. A 401 here triggers the client's refresh-and-retry.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await callBackend("/v1/me", { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = updateProfileSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await callBackend("/v1/me", { method: "PATCH", json: body, bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
