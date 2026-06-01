import { describe, it, expect } from "vitest";
import { formatPortInUse } from "../src/cli/port.js";

describe("formatPortInUse", () => {
  it("names the offending process and offers both a kill and a free-port command", () => {
    const msg = formatPortInUse(4321, { pid: 1234, command: "node dist/index.js" }, 4322);
    expect(msg).toContain("Port 4321 is already in use");
    expect(msg).toContain("1234");
    expect(msg).toContain("node dist/index.js"); // the actual command, so the user knows what it is
    expect(msg).toContain("kill 1234");
    expect(msg).toContain("ccaudit --port 4322"); // a ready-to-run command on a free port
  });

  it("handles an unidentifiable holder without offering a bogus kill", () => {
    const msg = formatPortInUse(4321, null, 4322);
    expect(msg).toContain("Port 4321 is already in use");
    expect(msg).toContain("ccaudit --port 4322");
    expect(msg).not.toContain("kill");
  });
});
