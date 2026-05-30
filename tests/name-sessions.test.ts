import { describe, it, expect } from "vitest";
import { buildNamePrompt, parseNames, nameSessions } from "../src/labeling/name-sessions.js";

describe("name-sessions: parseNames", () => {
  it("parses a JSON array of titles", () => {
    expect(parseNames('["Fix login bug", "Add dark mode"]', 2)).toEqual(["Fix login bug", "Add dark mode"]);
  });
  it("strips code fences, surrounding quotes, numbering and trailing punctuation", () => {
    const raw = '```json\n["1. \\"Refactor the parser\\".", "Set up CI pipeline"]\n```';
    expect(parseNames(raw, 2)).toEqual(["Refactor the parser", "Set up CI pipeline"]);
  });
  it("pads with empty strings when the model returns too few", () => {
    expect(parseNames('["Only one"]', 3)).toEqual(["Only one", "", ""]);
  });
  it("returns all-empty on unparseable output", () => {
    expect(parseNames("not json at all", 2)).toEqual(["", ""]);
  });
  it("recovers the first array even when prose surrounds it", () => {
    expect(parseNames('Here you go:\n["Fix the build", "Tune the query"] hope that helps', 2))
      .toEqual(["Fix the build", "Tune the query"]);
  });
});

describe("name-sessions: buildNamePrompt", () => {
  it("numbers each item and asks for a JSON array", () => {
    const p = buildNamePrompt([
      { sessionId: "a", context: "help me build a CLI" },
      { sessionId: "b", context: "debug the websocket" },
    ]);
    expect(p).toMatch(/<session 1>\nhelp me build a CLI\n<\/session 1>/);
    expect(p).toMatch(/<session 2>\ndebug the websocket\n<\/session 2>/);
    expect(p).toMatch(/JSON array of exactly 2 strings/i);
    expect(p).toMatch(/UNTRUSTED/);
  });
});

describe("name-sessions: nameSessions", () => {
  it("titles a batch via an injected run, aligned to input order", async () => {
    const run = async () => ({ result: '["First Title", "Second Title"]', costUsd: 0.01 });
    const { titles, costUsd } = await nameSessions(
      [{ sessionId: "a", context: "x" }, { sessionId: "b", context: "y" }],
      { run }
    );
    expect(titles).toEqual(["First Title", "Second Title"]);
    expect(costUsd).toBe(0.01);
  });
  it("returns empty for no items without calling the runner", async () => {
    let called = false;
    const run = async () => { called = true; return { result: "[]", costUsd: 1 }; };
    const out = await nameSessions([], { run });
    expect(out).toEqual({ titles: [], costUsd: 0 });
    expect(called).toBe(false);
  });
});
