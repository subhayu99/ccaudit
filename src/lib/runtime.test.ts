import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, writeFileSync } from "node:fs";
import { writeServeState, readServeState, clearServeState } from "./runtime";

const P = join(tmpdir(), `ccaudit-serve-test-${process.pid}.json`);
afterEach(() => rmSync(P, { force: true }));

describe("serve runtime state", () => {
  it("round-trips and derives the url", () => {
    writeServeState({ port: 4321, pid: 123, host: "127.0.0.1", startedAt: 1000 }, P);
    const s = readServeState(P);
    expect(s).toMatchObject({ port: 4321, pid: 123, host: "127.0.0.1", url: "http://127.0.0.1:4321" });
  });

  it("returns null for a missing file", () => {
    expect(readServeState(join(tmpdir(), "ccaudit-nope.json"))).toBeNull();
  });

  it("returns null for a malformed file", () => {
    writeFileSync(P, "{ not json");
    expect(readServeState(P)).toBeNull();
  });

  it("clear removes the file", () => {
    writeServeState({ port: 5000, pid: 1, host: "127.0.0.1", startedAt: 1 }, P);
    clearServeState(P);
    expect(readServeState(P)).toBeNull();
  });
});
