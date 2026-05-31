import type { APIRoute } from "astro";
import { getDb } from "../../db/init.js";
import { addExclusion, removeExclusion, addRule, removeRule, type RuleKind } from "../../db/exclusions.js";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const RULE_KINDS = ["session", "phrase", "regex"];

/**
 * Add or remove a hidden directory prefix. Same-origin JSON POST (the client
 * uses fetch); Astro's CSRF guard targets cross-site form posts, not JSON, so
 * this stays protected without disabling security. Hiding is lossless — indexed
 * rows are kept and just filtered from views — so this never triggers a reindex.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { action?: string; prefix?: string; prefixes?: string[]; kind?: string; value?: string; id?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const action = String(body.action ?? "");
  const db = getDb();

  // Rule actions (session / phrase / regex) — hide beyond directory prefixes.
  if (action === "add-rule") {
    const kind = String(body.kind ?? "");
    const value = String(body.value ?? "").trim();
    if (!RULE_KINDS.includes(kind) || !value) return json({ error: "bad rule" }, 400);
    addRule(db, kind as RuleKind, value);
    return json({ ok: true });
  }
  if (action === "remove-rule") {
    const id = Number(body.id);
    if (!Number.isFinite(id)) return json({ error: "bad id" }, 400);
    removeRule(db, id);
    return json({ ok: true });
  }

  // Prefix actions (hide a directory / repo / workdir).
  const raw = body.prefixes ?? (body.prefix !== undefined ? [body.prefix] : []);
  const prefixes = raw.map((p) => String(p).trim()).filter(Boolean);
  if (prefixes.length === 0 || (action !== "add" && action !== "remove")) {
    return json({ error: "bad request" }, 400);
  }
  for (const prefix of prefixes) {
    if (action === "add") addExclusion(db, prefix);
    else removeExclusion(db, prefix);
  }
  return json({ ok: true });
};
