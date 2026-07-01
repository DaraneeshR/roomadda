import { describe, expect, it } from "vitest";
import {
  canWithdrawNotice,
  daysUntilMoveOut,
  earliestMoveOutDate,
  isMoveOutDateValid,
} from "./leave-notice.logic.js";

const utc = (s: string) => new Date(s);

describe("isMoveOutDateValid (notice period = 30 days)", () => {
  const now = utc("2026-06-28T09:00:00Z"); // earliest move-out = 2026-07-28

  it("rejects a date inside the notice period", () => {
    expect(isMoveOutDateValid(utc("2026-07-10T00:00:00Z"), now)).toBe(false);
    expect(isMoveOutDateValid(utc("2026-07-27T00:00:00Z"), now)).toBe(false);
  });

  it("accepts a date on/after the earliest move-out", () => {
    expect(isMoveOutDateValid(utc("2026-07-28T00:00:00Z"), now)).toBe(true);
    expect(isMoveOutDateValid(utc("2026-08-30T00:00:00Z"), now)).toBe(true);
  });

  it("earliestMoveOutDate is today + the notice period (UTC midnight)", () => {
    expect(earliestMoveOutDate(now).toISOString()).toBe("2026-07-28T00:00:00.000Z");
  });
});

describe("canWithdrawNotice (lock = 3 days before move-out)", () => {
  const now = utc("2026-06-28T09:00:00Z");

  it("blocks withdrawal within 3 days of move-out", () => {
    expect(canWithdrawNotice(utc("2026-06-29T00:00:00Z"), now)).toBe(false); // 1 day
    expect(canWithdrawNotice(utc("2026-07-01T00:00:00Z"), now)).toBe(false); // exactly 3 days
  });

  it("allows withdrawal when more than 3 days remain", () => {
    expect(canWithdrawNotice(utc("2026-07-05T00:00:00Z"), now)).toBe(true); // 7 days
    expect(canWithdrawNotice(utc("2026-07-28T00:00:00Z"), now)).toBe(true);
  });

  it("counts whole calendar days regardless of time of day", () => {
    expect(daysUntilMoveOut(utc("2026-07-01T23:00:00Z"), now)).toBe(3);
  });
});
