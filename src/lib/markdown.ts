import { marked, type Tokens } from "marked";
import { createHighlighter, type Highlighter } from "shiki";

// Warm, on-brand dark theme; one curated language set keeps the highlighter's
// memory bounded. Anything else falls back to plain "text" (still styled, just
// not tokenized) — see the try/catch in walkTokens.
const THEME = "vesper";
const LANGS = [
  "ts", "tsx", "js", "jsx", "json", "jsonc", "bash", "shell", "python", "go",
  "rust", "sql", "html", "css", "scss", "yaml", "toml", "markdown", "diff",
  "dockerfile", "java", "c", "cpp", "ruby", "php", "astro", "vue", "swift",
];

// The highlighter loads grammars asynchronously and is expensive to build, so
// it's a process-wide singleton — first render pays the cost, the rest are warm.
let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  return (highlighterPromise ??= createHighlighter({ themes: [THEME], langs: LANGS }));
}

marked.setOptions({ gfm: true, breaks: true });

// Replace each fenced code block with shiki's tokenized HTML. Mutating the token
// to type "html" makes marked emit the highlighted markup verbatim (it owns the
// <pre>/<code> wrapper); inline `code` spans are type "codespan" and untouched.
marked.use({
  async: true,
  async walkTokens(token) {
    if (token.type !== "code") return;
    const code = token as Tokens.Code;
    const lang = (code.lang || "").trim().split(/\s+/)[0]?.toLowerCase() || "text";
    const hl = await getHighlighter();
    let html: string;
    try {
      html = hl.codeToHtml(code.text, { lang, theme: THEME });
    } catch {
      // unknown / unloaded language → render as plain text (never throws)
      html = hl.codeToHtml(code.text, { lang: "text", theme: THEME });
    }
    // Rewrite the code token to raw HTML so marked emits shiki's markup verbatim.
    token.type = "html";
    (token as Tokens.HTML).text = html;
  },
});

export async function renderMarkdown(input: string | null | undefined): Promise<string> {
  if (!input) return "";
  // `async: true` makes marked.parse return a Promise once an async walkTokens is registered.
  return await marked.parse(input);
}
