import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export async function renderMarkdown(input: string | null | undefined): Promise<string> {
  if (!input) return "";
  // `marked.parse` is sync by default but the type signature is sync-or-promise.
  // Use await to handle either form safely.
  return await marked.parse(input);
}
