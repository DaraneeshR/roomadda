import { describe, it, expect } from "vitest";
import { toPage } from "./pagination.js";

describe("toPage (cursor pagination)", () => {
  it("returns no cursor when rows fit within the limit", () => {
    const page = toPage([{ id: "a" }, { id: "b" }], 5);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("trims to limit and sets nextCursor to the last returned id when more exist", () => {
    const page = toPage([{ id: "a" }, { id: "b" }, { id: "c" }], 2);
    expect(page.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
  });
});
