import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password KDF (scrypt)", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("Correct-Horse-9!");
    expect(await verifyPassword("Correct-Horse-9!", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a self-describing scrypt hash with a random salt (never the raw password)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(a).not.toContain("same-password");
    // Different salts → different hashes for the same input; both still verify.
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("returns false (never throws) for a malformed/foreign hash", async () => {
    for (const bad of ["", "not-a-hash", "scrypt$oops", "bcrypt$1$2$3$4$5"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });
});
