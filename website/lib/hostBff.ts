import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { bearerFrom, callBackend, relayError } from "./backend";

/**
 * Thin proxy helpers for the host portal's BFF routes. Every host `/api/host/*`
 * route is the SAME shape: require the caller's in-memory access token, forward
 * it as a bearer to the backend host surface, and relay the response. The backend
 * is the single authority — it enforces the HOST/ADMIN role AND ownership (a
 * foreign listing/booking/request is a 404), so this layer only relays and keeps
 * `BACKEND_API_URL` off the client (the strict CSP stays `connect-src 'self'`).
 *
 * Money is display-only on the host web (read amounts, never compute) — these
 * helpers never touch the numbers, they pass the server's DTO straight through.
 */

/** Read the caller's access token, or a 401 response when it is absent. */
function requireBearer(req: NextRequest): { bearer: string } | { fail: NextResponse } {
  const bearer = bearerFrom(req);
  if (!bearer) return { fail: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  return { bearer };
}

/**
 * Proxy a GET to `path` on the backend with the caller's bearer. `path` should
 * already include any forwarded query string (`req.nextUrl.search`).
 */
export async function proxyGet(req: NextRequest, path: string): Promise<NextResponse> {
  const auth = requireBearer(req);
  if ("fail" in auth) return auth.fail;

  const result = await callBackend(path, { method: "GET", bearer: auth.bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}

/**
 * Proxy a mutation. When `schema` is provided the JSON body is validated at this
 * boundary (`.strict()` rejects unknown keys) and re-serialized; pass `null` for
 * no-body actions (accept, publish, checkout…). `okStatus` is the backend's
 * success code to pass through (200 default, 201 for creates, 204 for deletes).
 */
export async function proxyMutation(
  req: NextRequest,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  schema: ZodType | null,
  okStatus = 200,
): Promise<NextResponse> {
  const auth = requireBearer(req);
  if ("fail" in auth) return auth.fail;

  let json: unknown;
  if (schema) {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    json = parsed.data;
  }

  const result = await callBackend(path, { method, json, bearer: auth.bearer, from: req });
  if (result.status !== okStatus) return relayError(result);
  if (okStatus === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(result.body, { status: okStatus });
}

/** Encode a path segment (listing/room/booking id) for a backend URL. */
export function seg(value: string): string {
  return encodeURIComponent(value);
}
