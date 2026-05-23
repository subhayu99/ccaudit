import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/lib/markdown.js";

describe("lib/markdown", () => {
  it("renders bold and italic", async () => {
    const html = await renderMarkdown("This is **bold** and *italic*.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders fenced code blocks", async () => {
    const html = await renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("const x = 1");
  });

  it("renders an empty input as empty string", async () => {
    expect(await renderMarkdown("")).toBe("");
  });

  it("renders null/undefined input as empty string", async () => {
    expect(await renderMarkdown(null)).toBe("");
    expect(await renderMarkdown(undefined)).toBe("");
  });

  it("preserves newlines via marked's gfm breaks", async () => {
    const html = await renderMarkdown("line one\nline two");
    expect(html).toMatch(/line one[\s\S]*line two/);
  });
});
