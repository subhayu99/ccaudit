import { describe, it, expect } from "vitest";
import { buildAskPrompt, answerFromExcerpts, type AskExcerpt } from "../src/labeling/ask.js";

const ex = (n: number, text: string): AskExcerpt => ({ n, sessionId: "s" + n, lineNo: n * 10, title: "T" + n, text });

describe("ask", () => {
  it("builds a prompt with numbered excerpts and the question", () => {
    const p = buildAskPrompt("how do I deploy?", [ex(1, "run npm deploy"), ex(2, "use the CI pipeline")]);
    expect(p).toMatch(/Question: how do I deploy\?/);
    expect(p).toMatch(/\[1\] \(T1 · line 10\)/);
    expect(p).toMatch(/\[2\] \(T2 · line 20\)/);
    expect(p).toMatch(/untrusted data/i);
  });

  it("calls the injected run and returns its answer + cost", async () => {
    const run = async () => ({ answer: "Deploy with [1].", costUsd: 0.02 });
    const out = await answerFromExcerpts("q", [ex(1, "x")], { run });
    expect(out).toEqual({ answer: "Deploy with [1].", costUsd: 0.02 });
  });

  it("short-circuits with no excerpts (no run call, no cost)", async () => {
    let called = false;
    const run = async () => { called = true; return { answer: "x", costUsd: 1 }; };
    const out = await answerFromExcerpts("q", [], { run });
    expect(out).toEqual({ answer: "", costUsd: 0 });
    expect(called).toBe(false);
  });
});
