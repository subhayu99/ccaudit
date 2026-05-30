import { describe, it, expect } from "vitest";
import { buildClusterPrompt, parseClusters, clusterTopics } from "../src/labeling/cluster-topics.js";

const items = [
  { sessionId: "s1", title: "fix backend auth" },
  { sessionId: "s2", title: "campaign email outreach" },
  { sessionId: "s3", title: "backend deploy" },
];

describe("buildClusterPrompt", () => {
  it("numbers titles and asks for topic+members JSON", () => {
    const p = buildClusterPrompt(items);
    expect(p).toContain("1. fix backend auth");
    expect(p).toContain("3. backend deploy");
    expect(p).toMatch(/JSON/i);
  });
});

describe("parseClusters", () => {
  it("maps 1-based member indices back to session ids", () => {
    const out = parseClusters('[{"topic":"Backend","sessions":[1,3]},{"topic":"Outreach","sessions":[2]}]', items);
    expect(out).toEqual([
      { name: "Backend", sessionIds: ["s1", "s3"] },
      { name: "Outreach", sessionIds: ["s2"] },
    ]);
  });
  it("ignores out-of-range indices and empty topics", () => {
    const out = parseClusters('[{"topic":"X","sessions":[99]},{"topic":"Y","sessions":[2]}]', items);
    expect(out).toEqual([{ name: "Y", sessionIds: ["s2"] }]);
  });
  it("returns [] on unparseable output", () => {
    expect(parseClusters("nope", items)).toEqual([]);
  });
});

describe("clusterTopics", () => {
  it("runs the injected runner and returns topics + cost", async () => {
    const run = () => ({ result: '[{"topic":"Backend","sessions":[1,3]}]', costUsd: 0.08 });
    const out = await clusterTopics(items, { run });
    expect(out.topics).toEqual([{ name: "Backend", sessionIds: ["s1", "s3"] }]);
    expect(out.costUsd).toBe(0.08);
  });
  it("returns no topics for no items without calling the runner", async () => {
    let called = false;
    const out = await clusterTopics([], { run: () => { called = true; return { result: "[]", costUsd: 0 }; } });
    expect(out.topics).toEqual([]);
    expect(called).toBe(false);
  });
});
