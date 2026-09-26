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
  it("resumes a Codex session using its native id", () => {
    expect(buildResumeCommand("codex:thread-123", "/tmp/my project", "codex"))
      .toBe("cd '/tmp/my project'\ncodex resume thread-123");
  });
  it("quotes an unsafe native session id as a shell argument", () => {
    expect(buildResumeCommand("codex:bad;id", null, "codex"))
      .toBe("codex resume 'bad;id'  # original cwd unknown");
  });
});
