import { describe, it, expect } from "vitest";
import { computeAdEndDate, isAdFeatured } from "./ad.logic.js";

const now = new Date("2026-06-15T12:00:00.000Z");
const window = {
  startDate: new Date("2026-06-14T00:00:00.000Z"),
  endDate: new Date("2026-06-21T00:00:00.000Z"),
};

describe("isAdFeatured", () => {
  it("is featured only when APPROVED + in-window + listing PUBLISHED", () => {
    expect(isAdFeatured({ status: "APPROVED", ...window }, "PUBLISHED", now)).toBe(true);
  });

  it("is NOT featured for any non-APPROVED status", () => {
    for (const status of ["PENDING_PAYMENT", "PENDING_APPROVAL", "REJECTED", "EXPIRED", "CANCELLED"]) {
      expect(isAdFeatured({ status, ...window }, "PUBLISHED", now)).toBe(false);
    }
  });

  it("is NOT featured when the listing is not PUBLISHED", () => {
    for (const listingStatus of ["DRAFT", "PENDING_REVIEW", "SUSPENDED"]) {
      expect(isAdFeatured({ status: "APPROVED", ...window }, listingStatus, now)).toBe(false);
    }
  });

  it("is NOT featured outside the [startDate, endDate] window", () => {
    const beforeStart = { startDate: new Date("2026-06-16T00:00:00.000Z"), endDate: window.endDate };
    const afterEnd = { startDate: new Date("2026-06-01T00:00:00.000Z"), endDate: new Date("2026-06-10T00:00:00.000Z") };
    expect(isAdFeatured({ status: "APPROVED", ...beforeStart }, "PUBLISHED", now)).toBe(false);
    expect(isAdFeatured({ status: "APPROVED", ...afterEnd }, "PUBLISHED", now)).toBe(false);
  });
});

describe("computeAdEndDate", () => {
  it("DAY adds 1 day, WEEK adds 7", () => {
    const start = new Date("2026-06-15T00:00:00.000Z");
    expect(computeAdEndDate(start, "DAY").toISOString()).toBe("2026-06-16T00:00:00.000Z");
    expect(computeAdEndDate(start, "WEEK").toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });
});
