import { NextResponse, type NextRequest } from "next/server";
import { kycSubmitSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../lib/backend";

/**
 * Submit the three uploaded document keys for review. The backend validates that
 * every key belongs to the caller's own prefix and records a PENDING KycRecord;
 * re-submitting after a rejection is the re-upload path (handled backend-side).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = kycSubmitSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await callBackend("/v1/kyc", { method: "POST", json: body, bearer, from: req });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}
