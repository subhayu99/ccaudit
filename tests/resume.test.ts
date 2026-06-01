import { describe, it, expect } from "vitest";
import { buildResumeCommand } from "../src/lib/resume.js";

describe("buildResumeCommand", () => {
  it("emits the two-line cd + resume snippet for a known cwd", () => {
    expect(buildResumeCommand("s-1", "/Users/me/proj"))
      .toBe("cd '/Users/me/proj'\nclaude --resume s-1");
  });
  it("posix-quotes a cwd containing a single quote", () => {
    expect(buildResumeCommand("s-1", "/tmp/o'brien"))
      .toBe("cd '/tmp/o'\\''brien'\nclaude --resume s-1");
  });
  it("falls back to a one-liner with a note when cwd is null", () => {
    expect(buildResumeCommand("s-1", null))
      .toBe("claude --resume s-1  # original cwd unknown");
  });
});
