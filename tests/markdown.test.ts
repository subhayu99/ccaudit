import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/lib/markdown.js";

describe("lib/markdown", () => {
  it("renders bold and italic", async () => {
    const html = await renderMarkdown("This is **bold** and *italic*.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  const stripTags = (h: string) => h.replace(/<[^>]+>/g, "");

  it("renders fenced code blocks with shiki syntax highlighting", async () => {
    const html = await renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("shiki"); // shiki wrapper class present
    expect(html).toMatch(/<span[^>]*style=/); // tokens carry per-token inline colors
    expect(stripTags(html)).toContain("const x = 1"); // code text preserved across the token spans
  });

  it("falls back to plain text for an unknown language without throwing", async () => {
    const html = await renderMarkdown("```wat\nhello world\n```");
    expect(html).toContain("<pre");
    expect(stripTags(html)).toContain("hello world");
  });

  it("leaves inline code as a plain <code> element (not shiki)", async () => {
    const html = await renderMarkdown("use `npm test` to run");
    expect(html).toContain("<code>npm test</code>");
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
