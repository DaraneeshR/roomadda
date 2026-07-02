import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { e164Schema, type SelfUser } from "@roomadda/shared";
import { callBackend, relayError, setRefreshCookie } from "../../../../../lib/backend";

/**
 * Verify the OTP and start a web session.
 *
 * We call the backend as a `mobile` client so it returns the refresh token in the
 * body; this server then stores it in an httpOnly + Secure + SameSite=strict
 * cookie on the WEBSITE origin. The browser only ever receives the access token
 * (held in memory) and the opaque cookie — the refresh token never reaches
 * client JS, so it can never land in localStorage.
 *
 * No `appAudience` is sent: the website is not role-gated, and the backend
 * upserts by phone, so this is the SAME account as the mobile apps.
 */
const bodySchema = z
  .object({ phone: e164Schema, code: z.string().regex(/^\d{6}$/, "code must be 6 digits") })
  .strict();

interface MobileSession {
  accessToken: string;
  refreshToken: string;
  user: SelfUser;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await callBackend("/v1/auth/otp/verify", {
    method: "POST",
    json: { phone: input.phone, code: input.code, client: "mobile" },
    from: req,
  });

  if (result.status !== 200) return relayError(result);

  const session = result.body as MobileSession;
  // A brand-new user has an empty name until they complete the profile step.
  const needsProfile = session.user.fullName.trim() === "";
  const res = NextResponse.json({
    accessToken: session.accessToken,
    user: session.user,
    needsProfile,
  });
  setRefreshCookie(res, session.refreshToken);
  return res;
}
