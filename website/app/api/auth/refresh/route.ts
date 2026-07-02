import { NextResponse, type NextRequest } from "next/server";
import type { SelfUser } from "@roomadda/shared";
import {
  REFRESH_COOKIE,
  callBackend,
  clearRefreshCookie,
  setRefreshCookie,
} from "../../../../lib/backend";

/**
 * Rotate the session from the httpOnly refresh cookie. Used to bootstrap on page
 * load (so the session survives reloads) and by the client's 401 interceptor.
 *
 * On any backend rejection the cookie is cleared and 401 returned, so the client
 * falls back to anonymous — never a stuck, half-authenticated state.
 */
interface MobileSession {
  accessToken: string;
  refreshToken: string;
  user: SelfUser;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const presented = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!presented) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const result = await callBackend("/v1/auth/refresh", {
    method: "POST",
    json: { client: "mobile", refreshToken: presented },
    from: req,
  });

  if (result.status !== 200) {
    const res = NextResponse.json({ error: "refresh_failed" }, { status: 401 });
    clearRefreshCookie(res);
    return res;
  }

  const session = result.body as MobileSession;
  const res = NextResponse.json({ accessToken: session.accessToken, user: session.user });
  // The backend rotates the refresh token on every use — persist the successor.
  setRefreshCookie(res, session.refreshToken);
  return res;
}
