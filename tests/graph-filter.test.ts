import { describe, it, expect } from "vitest";
import { filterGraphByTypes } from "../src/lib/graph-filter.js";
import type { GraphData } from "../src/db/graph.js";

// repo R ← workdir W ← {S1, S2};  S1 → topic T
const FIXTURE: GraphData = {
  nodes: [
    { id: "repo:R", type: "repo", label: "R", workdirCount: 1 },
    { id: "workdir:W", type: "workdir", label: "W", workdirPath: "/W" },
    { id: "sess:S1", type: "session", label: "S1", sessionId: "S1", messageCount: 3 },
    { id: "sess:S2", type: "session", label: "S2", sessionId: "S2", messageCount: 3 },
    { id: "topic:1", type: "topic", label: "T", sessionCount: 1 },
  ],
  links: [
    { source: "sess:S1", target: "workdir:W", kind: "session-workdir" },
    { source: "sess:S2", target: "workdir:W", kind: "session-workdir" },
    { source: "workdir:W", target: "repo:R", kind: "workdir-repo" },
    { source: "sess:S1", target: "topic:1", kind: "session-topic" },
  ],
};

const ids = (g: GraphData) => g.nodes.map((n) => n.id).sort();
const linkPairs = (g: GraphData) => g.links.map((l) => `${l.source}->${l.target}`).sort();
const ALL = new Set(["repo", "workdir", "session", "topic"]);

describe("filterGraphByTypes", () => {
  it("keeps the full graph when every type is visible", () => {
    const g = filterGraphByTypes(FIXTURE, ALL);
    expect(ids(g)).toEqual(["repo:R", "sess:S1", "sess:S2", "topic:1", "workdir:W"]);
    expect(linkPairs(g)).toEqual([
      "sess:S1->topic:1",
      "sess:S1->workdir:W",
      "sess:S2->workdir:W",
      "workdir:W->repo:R",
    ]);
  });

  it("reconnects sessions straight to their repo when folders are hidden", () => {
    const g = filterGraphByTypes(FIXTURE, new Set(["repo", "session", "topic"]));
    expect(ids(g)).toEqual(["repo:R", "sess:S1", "sess:S2", "topic:1"]);
    // sessions bridge to the repo (nearest visible ancestor); the workdir-repo edge is gone
    expect(linkPairs(g)).toEqual(["sess:S1->repo:R", "sess:S1->topic:1", "sess:S2->repo:R"]);
    expect(g.links.find((l) => l.source === "sess:S1" && l.target === "repo:R")!.kind).toBe("session-repo");
  });

  it("drops the workdir→repo edge when only the repo is hidden", () => {
    const g = filterGraphByTypes(FIXTURE, new Set(["workdir", "session", "topic"]));
    expect(ids(g)).toEqual(["sess:S1", "sess:S2", "topic:1", "workdir:W"]);
    expect(linkPairs(g)).toEqual(["sess:S1->topic:1", "sess:S1->workdir:W", "sess:S2->workdir:W"]);
  });

  it("removes topic nodes and their links when topics are hidden", () => {
    const g = filterGraphByTypes(FIXTURE, new Set(["repo", "workdir", "session"]));
    expect(ids(g)).toEqual(["repo:R", "sess:S1", "sess:S2", "workdir:W"]);
    expect(linkPairs(g)).toEqual(["sess:S1->workdir:W", "sess:S2->workdir:W", "workdir:W->repo:R"]);
  });

  it("leaves topics orphaned (no links) when sessions are hidden", () => {
    const g = filterGraphByTypes(FIXTURE, new Set(["repo", "workdir", "topic"]));
    expect(ids(g)).toEqual(["repo:R", "topic:1", "workdir:W"]);
    expect(linkPairs(g)).toEqual(["workdir:W->repo:R"]); // topic has no visible session to attach to
  });

  it("bridges sessions to repo when both folders and topics are hidden, no duplicate edges", () => {
    const g = filterGraphByTypes(FIXTURE, new Set(["repo", "session"]));
    expect(ids(g)).toEqual(["repo:R", "sess:S1", "sess:S2"]);
    expect(linkPairs(g)).toEqual(["sess:S1->repo:R", "sess:S2->repo:R"]);
  });
});
