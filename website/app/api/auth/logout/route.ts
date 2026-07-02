import { NextResponse, type NextRequest } from "next/server";
import { REFRESH_COOKIE, callBackend, clearRefreshCookie } from "../../../../lib/backend";

/**
 * End the session: revoke the token family on the backend and clear the cookie.
 * Idempotent — a missing cookie still clears cleanly and returns 204.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const presented = req.cookies.get(REFRESH_COOKIE)?.value;
  if (presented) {
    await callBackend("/v1/auth/logout", {
      method: "POST",
      json: { refreshToken: presented },
      from: req,
    });
  }
  const res = new NextResponse(null, { status: 204 });
  clearRefreshCookie(res);
  return res;
}
