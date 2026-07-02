/** Read Set-Cookie header(s) off a Response across runtimes. */
export function getSetCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    const all = headers.getSetCookie();
    if (all.length > 0) return all;
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/** The full serialized Set-Cookie string for `name`, or null. */
export function findSetCookie(res: Response, name: string): string | null {
  return getSetCookies(res).find((c) => c.startsWith(`${name}=`)) ?? null;
}

/** The value of a serialized Set-Cookie string (before the first `;`). */
export function cookieValue(serialized: string): string {
  const pair = serialized.split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice(pair.indexOf("=") + 1));
}
