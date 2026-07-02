import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../lib/backend";

/** The caller's own KYC status (+ rejection reason). Drives the status view. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await callBackend("/v1/kyc/me", { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
