import { describe, it, expect } from "vitest";
import { prioritizeRunning } from "./running-sessions.js";

const t = (id: string) => ({ id });

describe("prioritizeRunning", () => {
  it("hoists running ids to the front, keeping each group's original order", () => {
    const out = prioritizeRunning([t("a"), t("b"), t("c"), t("d")], ["c", "a"]);
    expect(out.map((x) => x.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("is a no-op when nothing is running", () => {
    expect(prioritizeRunning([t("a"), t("b")], []).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("ignores running ids not present in the targets", () => {
    expect(prioritizeRunning([t("a"), t("b")], ["zzz", "b"]).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("returns a new array and does not mutate the input", () => {
    const input = [t("a"), t("b")];
    const out = prioritizeRunning(input, ["b"]);
    expect(out).not.toBe(input);
    expect(input.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
