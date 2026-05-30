import { describe, it, expect } from "vitest";
import { buildAskPrompt, answerFromExcerpts, contentTerms, isLowSignalExcerpt, type AskExcerpt } from "../src/labeling/ask.js";

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

describe("ask retrieval helpers", () => {
  it("contentTerms strips stopwords/question words, keeps meaningful terms", () => {
    expect(contentTerms("What did i work on Loop Inspect?")).toEqual(["loop", "inspect"]);
    expect(contentTerms("how does the stripe webhook work")).toEqual(["stripe", "webhook"]);
    expect(contentTerms("what is it")).toEqual([]); // all stopwords
  });

  it("isLowSignalExcerpt drops dumps/greetings, keeps prose", () => {
    expect(isLowSignalExcerpt("Hi")).toBe(true); // too short
    expect(isLowSignalExcerpt("/Users/x/loop-inspect /Users/x/loop-inspect/ext /Users/x/loop-inspect/src")).toBe(true); // path dump
    expect(isLowSignalExcerpt('{"a":1,"b":[2,3],"c":{"d":4}} 1234567890')).toBe(true); // blob
    expect(isLowSignalExcerpt("I refactored the Loop Inspect ingestion pipeline to batch the events.")).toBe(false);
  });
});
