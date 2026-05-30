import { describe, it, expect } from "vitest";
import { capSessionsPerHub, type GraphData } from "../src/db/graph.js";

function makeGraph(hubs: Array<{ hub: string; sessions: Array<{ id: string; ts: number }> }>): GraphData {
  const nodes: GraphData["nodes"] = [];
  const links: GraphData["links"] = [];
  for (const { hub, sessions } of hubs) {
    nodes.push({ id: hub, type: "topic", label: hub });
    for (const s of sessions) {
      nodes.push({ id: s.id, type: "session", label: s.id, sessionId: s.id, lastActivity: s.ts });
      links.push({ source: s.id, target: hub, kind: "session-topic" });
    }
  }
  return { nodes, links };
}

describe("capSessionsPerHub", () => {
  it("keeps the K most-recent sessions per hub and drops the rest", () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, ts: i })); // ts 0..19
    const { data, droppedSessions } = capSessionsPerHub(makeGraph([{ hub: "topic:1", sessions }]), 5);
    expect(droppedSessions).toBe(15);
    const kept = data.nodes.filter((n) => n.type === "session").map((n) => n.id).sort();
    expect(kept.sort()).toEqual(["s15", "s16", "s17", "s18", "s19"].sort()); // newest 5 (highest ts)
    expect(data.nodes.some((n) => n.id === "topic:1")).toBe(true); // hub kept
    expect(data.links).toHaveLength(5); // only links to kept sessions
  });

  it("leaves hubs at or under the cap untouched", () => {
    const g = makeGraph([{ hub: "topic:1", sessions: [{ id: "a", ts: 1 }, { id: "b", ts: 2 }] }]);
    const { data, droppedSessions } = capSessionsPerHub(g, 5);
    expect(droppedSessions).toBe(0);
    expect(data).toBe(g); // unchanged reference when nothing dropped
  });

  it("caps each hub independently", () => {
    const g = makeGraph([
      { hub: "topic:1", sessions: Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, ts: i })) },
      { hub: "topic:2", sessions: [{ id: "b0", ts: 1 }] },
    ]);
    const { droppedSessions } = capSessionsPerHub(g, 3);
    expect(droppedSessions).toBe(5); // hub1: 8-3=5 dropped; hub2: 0
  });
});
