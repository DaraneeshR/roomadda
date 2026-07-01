import { describe, expect, it } from "vitest";
import { containsPhoneNumber } from "./chat.logic.js";

describe("containsPhoneNumber (no phone numbers in chat)", () => {
  it("flags phone numbers in various formats", () => {
    expect(containsPhoneNumber("call me at 9876543210")).toBe(true);
    expect(containsPhoneNumber("my number is +91 98765 43210")).toBe(true);
    expect(containsPhoneNumber("ring 98765-43210 anytime")).toBe(true);
    expect(containsPhoneNumber("+919876543210")).toBe(true);
    expect(containsPhoneNumber("9 8 7 6 5 4 3 2 1 0")).toBe(true);
  });

  it("does not flag ordinary text or short numbers", () => {
    expect(containsPhoneNumber("see you at room 204")).toBe(false);
    expect(containsPhoneNumber("my pincode is 560001")).toBe(false);
    expect(containsPhoneNumber("rent is ₹12,000.00")).toBe(false);
    expect(containsPhoneNumber("meet me at 5 near gate 3")).toBe(false);
    expect(containsPhoneNumber("Thanks! See you tomorrow.")).toBe(false);
  });
});
