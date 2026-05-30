import { describe, expect, it } from "vitest";
import { posixQuote } from "./shell.js";

describe("posixQuote", () => {
  it("wraps a simple string in single quotes", () => {
    expect(posixQuote("/Users/me/project")).toBe("'/Users/me/project'");
  });

  it("preserves spaces inside the quotes", () => {
    expect(posixQuote("/Users/me/my project")).toBe("'/Users/me/my project'");
  });

  it("escapes an embedded single quote", () => {
    // foo'bar -> 'foo'\''bar'
    expect(posixQuote("foo'bar")).toBe("'foo'\\''bar'");
  });

  it("does not interpret $ as expansion (left literal inside single quotes)", () => {
    expect(posixQuote("/tmp/$HOME")).toBe("'/tmp/$HOME'");
  });

  it("neutralizes command separators like ; and &&", () => {
    expect(posixQuote("/tmp; rm -rf /")).toBe("'/tmp; rm -rf /'");
    expect(posixQuote("/tmp && echo pwned")).toBe("'/tmp && echo pwned'");
  });

  it("handles an empty string", () => {
    expect(posixQuote("")).toBe("''");
  });
});
