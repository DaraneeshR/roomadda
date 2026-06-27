import { describe, expect, it } from "vitest";
import { kycObjectKey, kycPrefix } from "./kyc.service.js";

/** Pure key-building rules: every object lands under the caller's own prefix
 *  with the right extension, so keys can't be forged across users. */
describe("kyc object keys", () => {
  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  it("namespaces a key under the user's private prefix", () => {
    const key = kycObjectKey(userA, "aadhaar_front", "image/jpeg");
    expect(key.startsWith(kycPrefix(userA))).toBe(true);
    expect(key).toContain("aadhaar_front-");
    expect(key.endsWith(".jpg")).toBe(true);
  });

  it("maps each allowed MIME to its extension", () => {
    expect(kycObjectKey(userA, "aadhaar_back", "image/png").endsWith(".png")).toBe(true);
    expect(kycObjectKey(userA, "supporting", "application/pdf").endsWith(".pdf")).toBe(true);
  });

  it("one user's key is never under another user's prefix", () => {
    const key = kycObjectKey(userA, "supporting", "image/jpeg");
    expect(key.startsWith(kycPrefix(userB))).toBe(false);
  });
});
