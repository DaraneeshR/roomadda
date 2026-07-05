import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing for §15.7 back-office team logins. Uses Node's built-in
 * `scrypt` — a memory-hard KDF suitable for low-entropy human passwords (unlike
 * the plain SHA-256 the OTP/refresh tokens use, which is only safe for
 * high-entropy random secrets). No external dependency; the raw password is never
 * stored or logged. The cost parameters are encoded into the hash string so they
 * can be tuned later without invalidating existing hashes.
 */

/** Promise wrapper around the callback `scrypt` that keeps the options overload. */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const SALT_BYTES = 16;
const KEY_LENGTH = 64;
// N=2^15, r=8, p=1 → ~32 MiB of work per hash. maxmem is raised above the default
// 32 MiB so this configuration is not rejected at the memory boundary.
const COST_N = 32_768;
const COST_R = 8;
const COST_P = 1;
const MAX_MEM = 64 * 1024 * 1024;

/** Hash a plaintext password into a self-describing `scrypt$N$r$p$salt$hash` string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(password, salt, KEY_LENGTH, {
    N: COST_N,
    r: COST_R,
    p: COST_P,
    maxmem: MAX_MEM,
  }));
  return `scrypt$${COST_N}$${COST_R}$${COST_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verify a plaintext password against a stored hash in constant time. Returns
 * false (never throws) for any malformed/foreign hash so a caller can treat it as
 * a plain auth failure.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  if (!nStr || !rStr || !pStr || !saltHex || !hashHex) return false;

  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  try {
    const derived = (await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: MAX_MEM }));
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
