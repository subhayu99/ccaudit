import { describe, expect, it } from "vitest";
import { decodeProjectDir, projectLabel } from "./paths.js";

describe("decodeProjectDir", () => {
  it("decodes leading-dash + dash-slashes into a path", () => {
    expect(decodeProjectDir("-Users-me-project")).toBe("/Users/me/project");
  });

  it("never produces a double slash for the --->// quirk", () => {
    // Claude encodes a path that already had a trailing/leading slash quirk as
    // "--", which naively decodes to "//". Output must be collapsed.
    const out = decodeProjectDir("-Users-me--project");
    expect(out).not.toContain("//");
    expect(out).toBe("/Users/me/project");
  });

  it("collapses runs of more than two dashes too", () => {
    expect(decodeProjectDir("-a---b")).not.toContain("//");
  });
});

describe("projectLabel", () => {
  it("returns the last two path segments", () => {
    expect(projectLabel("/Users/me/LoopProjects/backend")).toBe("LoopProjects/backend");
  });
});
