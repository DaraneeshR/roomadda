import { describe, expect, it } from "vitest";
import { isVisibleTo, visibilityWhere, visibleVisibilities } from "./visibility.js";

/**
 * Pure unit tests for the visibility-audience filter (the server-side half of the
 * Hotel B2C add-on's "a CORPORATE_ONLY listing NEVER appears in a B2C response"
 * invariant). The DB-level proof (a CORPORATE_ONLY listing absent from an actual
 * listPublished query) lives in hotel.integration.test.ts.
 */
describe("listing visibility filter", () => {
  it("B2C sees USER_ONLY + BOTH, never CORPORATE_ONLY", () => {
    expect(visibleVisibilities("B2C")).toEqual(["USER_ONLY", "BOTH"]);
    expect(isVisibleTo("B2C", "USER_ONLY")).toBe(true);
    expect(isVisibleTo("B2C", "BOTH")).toBe(true);
    expect(isVisibleTo("B2C", "CORPORATE_ONLY")).toBe(false);
  });

  it("CORPORATE sees CORPORATE_ONLY + BOTH, never USER_ONLY", () => {
    expect(visibleVisibilities("CORPORATE")).toEqual(["CORPORATE_ONLY", "BOTH"]);
    expect(isVisibleTo("CORPORATE", "CORPORATE_ONLY")).toBe(true);
    expect(isVisibleTo("CORPORATE", "BOTH")).toBe(true);
    expect(isVisibleTo("CORPORATE", "USER_ONLY")).toBe(false);
  });

  it("the two audiences overlap ONLY on BOTH (the *_ONLY sets are disjoint)", () => {
    const b2c = new Set(visibleVisibilities("B2C"));
    const corp = new Set(visibleVisibilities("CORPORATE"));
    const shared = [...b2c].filter((v) => corp.has(v));
    expect(shared).toEqual(["BOTH"]);
  });

  it("builds a Prisma `where` fragment restricting visibility for the audience", () => {
    expect(visibilityWhere("B2C")).toEqual({ visibility: { in: ["USER_ONLY", "BOTH"] } });
    expect(visibilityWhere("CORPORATE")).toEqual({ visibility: { in: ["CORPORATE_ONLY", "BOTH"] } });
  });
});
