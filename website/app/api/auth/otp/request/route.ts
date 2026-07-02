import { NextResponse, type NextRequest } from "next/server";
import { otpRequestSchema } from "@roomadda/shared";
import { callBackend, relayError } from "../../../../../lib/backend";

/**
 * Start the OTP login: relay `{ phone }` to the backend, which sends the code and
 * always answers 202 (it never reveals whether a number exists). This site never
 * sees or stores the OTP.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let phone: string;
  try {
    ({ phone } = otpRequestSchema.parse(await req.json()));
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await callBackend("/v1/auth/otp/request", {
    method: "POST",
    json: { phone },
    from: req,
  });

  if (result.status !== 202) return relayError(result);
  return NextResponse.json(result.body, { status: 202 });
}
