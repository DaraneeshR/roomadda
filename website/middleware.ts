import { NextResponse, type NextRequest } from "next/server";

/**
 * Razorpay web-checkout origins. Checkout.js is injected by our own (nonce-
 * trusted) bundle, so `strict-dynamic` covers the SCRIPT; but the checkout modal
 * is served in an iframe and talks to api.razorpay.com over XHR, so those hosts
 * must be allow-listed for `frame-src` / `connect-src` / `form-action` (which
 * `strict-dynamic` does not govern). The public key id — never the secret — is
 * the only Razorpay credential that reaches the browser.
 */
const RAZORPAY_SCRIPT = "https://checkout.razorpay.com";
const RAZORPAY_FRAME = "https://api.razorpay.com https://checkout.razorpay.com";
const RAZORPAY_CONNECT = "https://api.razorpay.com https://lumberjack.razorpay.com";
const RAZORPAY_FORM = "https://api.razorpay.com";

/**
 * Per-request strict Content-Security-Policy with a nonce. Next reads the CSP
 * from the request header and applies the nonce to its own scripts, so we can
 * forbid inline scripts (strict-dynamic + nonce). The OpenStreetMap embed and
 * the Razorpay checkout iframe are the only allowed external frames.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.randomUUID());

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${RAZORPAY_SCRIPT} ${process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self'`,
    `connect-src 'self' ${RAZORPAY_CONNECT}`,
    `frame-src https://www.openstreetmap.org ${RAZORPAY_FRAME}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self' ${RAZORPAY_FORM}`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads this off the request to nonce its scripts.
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Skip Next internals + static assets.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
