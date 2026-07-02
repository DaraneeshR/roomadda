import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "./env";

/**
 * Server-side ("BFF") boundary to the RoomAdda backend. The browser NEVER talks
 * to the backend directly — it only calls this website's own `/api/*` routes, so
 *   1. the strict CSP (`connect-src 'self'`) stays intact, and
 *   2. `BACKEND_API_URL` and the refresh token never enter the client bundle.
 *
 * The backend remains the single source of truth for auth: it verifies the OTP,
 * mints the tokens, and merges users on phone (`same phone = same account`).
 * This layer only relays and manages the refresh cookie on the website origin.
 */

/** httpOnly refresh-token cookie, scoped to the auth routes on THIS origin. */
export const REFRESH_COOKIE = "ra_rt";
/** Only `/api/auth/*` ever needs the refresh token, so scope it there. */
export const REFRESH_COOKIE_PATH = "/api/auth";
/** Mirror the backend's 30-day refresh TTL. */
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

/** Secure in prod; relaxed for local http dev (mirrors the backend's posture). */
const isProduction = process.env.NODE_ENV === "production";

/** Attach the refresh token as an httpOnly + Secure + SameSite=strict cookie. */
export function setRefreshCookie(res: NextResponse, token: string): void {
  res.cookies.set(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_MAX_AGE,
  });
}

/** Clear the refresh cookie (logout / failed refresh). */
export function clearRefreshCookie(res: NextResponse): void {
  res.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
}

export interface BackendResult {
  status: number;
  /** Parsed JSON body, or null for empty/non-JSON responses (e.g. 204). */
  body: unknown;
}

/**
 * Call a backend endpoint server-side. Forwards the caller's real IP so the
 * backend's per-IP rate limiting keys on the end user, not this server
 * (`trustProxy` is on in the backend).
 */
export async function callBackend(
  path: string,
  init: {
    method: string;
    /** JSON body (stringified here) — omit for GET. */
    json?: unknown;
    /** The end user's access token, forwarded as a bearer for proxied calls. */
    bearer?: string | null;
    /** The inbound request, used to forward the client IP. */
    from?: NextRequest;
  },
): Promise<BackendResult> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`;
  const ip = init.from ? clientIp(init.from) : null;
  if (ip) headers["x-forwarded-for"] = ip;

  const res = await fetch(`${env.BACKEND_API_URL}${path}`, {
    method: init.method,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    // Never cache authenticated/auth traffic.
    cache: "no-store",
  });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, body };
}

/** The bearer access token from the inbound request's Authorization header. */
export function bearerFrom(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/** First hop of X-Forwarded-For, else X-Real-IP. */
export function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

/**
 * Relay a backend error to the client with a stable shape, without leaking
 * internals. The backend envelope is `{ error: { code, message } }`; we pass the
 * `code` (e.g. OTP_INVALID) and a safe message through so the UI can react.
 */
export function relayError(result: BackendResult): NextResponse {
  const envelope = result.body as { error?: { code?: string; message?: string } } | null;
  const inner = envelope?.error;
  return NextResponse.json(
    {
      error: inner?.code ?? "request_failed",
      message: inner?.message ?? "Something went wrong. Please try again.",
    },
    { status: result.status >= 400 ? result.status : 502 },
  );
}
