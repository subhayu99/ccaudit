import type { Db } from "./init.js";
import { listWorkdirs } from "./workdirs.js";
import { computeRepoComponents } from "../identity/components.js";
import { listExclusions, sessionKeepCondition, rulesSignature } from "./exclusions.js";
import { cleanPromptText } from "../lib/clean-prompt.js";
import { sessionCostUsd, type TokenUsage } from "../lib/pricing.js";
import { rangeCondition, type DateRange } from "./date-range.js";

function parseTokenUsage(raw: string | null): TokenUsage | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as TokenUsage; } catch { return null; }
}

export type DayLabel = "Today" | "Yesterday" | "Earlier this week" | "Older";

/** Bucket a timestamp into a coarse recency label relative to nowMs (local midnight math). */
export function dayBucket(ts: number | null, nowMs: number): DayLabel {
  if (ts === null) return "Older";
  const startOfDay = (m: number) => {
    const d = new Date(m);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const today = startOfDay(nowMs);
  const dayMs = 86_400_000;
  const diffDays = Math.round((today - startOfDay(ts)) / dayMs);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Earlier this week";
  return "Older";
}

export type LibrarySession = {
  id: string;
  title: string;
  lastActivity: number | null;
  messageCount: number;
  compactCount: number;
  costUsd: number;
  workdirPath: string;
};
export type LibraryWorkdir = {
  path: string;
  label: string;
  existsOnDisk: boolean;
  sessionCount: number;
  sessions: LibrarySession[];
};
export type LibraryRepo = {
  repoId: string;
  displayName: string;
  remote: string | null;
  workdirCount: number;
  sessionCount: number;
  workdirs: LibraryWorkdir[];
};
export type LibraryTree = { repos: LibraryRepo[]; totalCount: number };

function basename(p: string): string {
  const segs = p.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1]! : p;
}
function titleOf(aiTitle: string | null, firstPrompt: string | null, id: string): string {
  const raw = aiTitle ?? (firstPrompt ? cleanPromptText(firstPrompt) : "") ?? "";
  const t = raw.replace(/\s+/g, " ").trim();
  return t || id.slice(0, 8);
}

type LibRow = {
  id: string; cwd: string; ai_title: string | null; first_prompt: string | null;
  last_activity: number | null; message_count: number; compact_count: number;
  token_usage: string | null;
};

// Per-connection memo cache for getLibraryTree. Keyed by Database instance so
// tests (and multiple DBs) never cross-contaminate. Invalidated when the cheap
// signature (newest indexed_at, session count, exclusion set) changes.
const treeCache = new WeakMap<Db, { key: string; tree: LibraryTree }>();

/** Cheap signature that changes whenever the tree would differ: newest indexed_at,
 *  total session count, and the (small) set of excluded prefixes. */
function libraryTreeKey(db: Db): string {
  const meta = db
    .prepare("SELECT MAX(indexed_at) AS maxIndexedAt, COUNT(*) AS sessionCount FROM sessions")
    .get() as { maxIndexedAt: number | null; sessionCount: number };
  const exclusionsSig = listExclusions(db).join("");
  return `${meta.maxIndexedAt ?? ""}|${meta.sessionCount}|${exclusionsSig}|${rulesSignature(db)}`;
}

export function getLibraryTree(db: Db, range: DateRange | null = null): LibraryTree {
  // Range participates in the cache key so a filtered tree never gets served for "all time".
  const key = `${libraryTreeKey(db)}|${range ? `${range.from}-${range.to}` : "all"}`;
  const cached = treeCache.get(db);
  if (cached && cached.key === key) return cached.tree;

  const tree = buildLibraryTree(db, range);
  treeCache.set(db, { key, tree });
  return tree;
}

function buildLibraryTree(db: Db, range: DateRange | null): LibraryTree {
  const workdirs = listWorkdirs(db);
  const { repos, repoByPath } = computeRepoComponents(workdirs);
  const existsByPath = new Map(workdirs.map((w) => [w.path, w.existsOnDisk]));

  const excl = sessionKeepCondition(db);
  const rg = rangeCondition(range, "last_activity");
  const rows = db
    .prepare(
      `SELECT id, cwd, ai_title, first_prompt, last_activity AS last_activity,
              message_count AS message_count, compact_count AS compact_count, token_usage
         FROM sessions
        WHERE cwd IS NOT NULL AND ${excl.sql} AND ${rg.sql}
        ORDER BY last_activity DESC`
    )
    .all({ ...excl.params, ...rg.params }) as LibRow[];

  // group sessions by workdir path
  const byWorkdir = new Map<string, LibrarySession[]>();
  for (const r of rows) {
    const s: LibrarySession = {
      id: r.id, title: titleOf(r.ai_title, r.first_prompt, r.id),
      lastActivity: r.last_activity, messageCount: r.message_count,
      compactCount: r.compact_count, costUsd: sessionCostUsd(parseTokenUsage(r.token_usage)),
      workdirPath: r.cwd,
    };
    const list = byWorkdir.get(r.cwd);
    if (list) list.push(s);
    else byWorkdir.set(r.cwd, [s]);
  }

  // assemble repos from components that have ≥1 visible session
  const repoMap = new Map<string, LibraryRepo>();
  for (const r of repos) repoMap.set(r.repoId, {
    repoId: r.repoId, displayName: r.displayName, remote: r.remote,
    workdirCount: 0, sessionCount: 0, workdirs: [],
  });

  for (const [path, sessions] of byWorkdir) {
    const repoId = repoByPath.get(path);
    if (!repoId) continue;
    const repo = repoMap.get(repoId);
    if (!repo) continue;
    repo.workdirs.push({
      path, label: basename(path), existsOnDisk: existsByPath.get(path) ?? false,
      sessionCount: sessions.length, sessions,
    });
    repo.workdirCount += 1;
    repo.sessionCount += sessions.length;
  }

  const visible = [...repoMap.values()].filter((r) => r.sessionCount > 0);
  visible.forEach((r) => r.workdirs.sort((a, b) => b.sessionCount - a.sessionCount));
  visible.sort((a, b) => b.sessionCount - a.sessionCount || a.displayName.localeCompare(b.displayName));

  return { repos: visible, totalCount: rows.length };
}

export type Selection =
  | { repo: string }
  | { workdir: string }
  | { topic: number; topicName: string; topicIds: string[] }
  | { mode: "recent" | "all" };

export type ListItem = {
  id: string; title: string; workdirLabel: string;
  lastActivity: number | null; messageCount: number; compactCount: number; costUsd: number;
};
export type SortMode = "time" | "cost" | "messages";
export type ListGroup = { label: DayLabel | "Recent" | "Most expensive" | "Most messages"; items: ListItem[] };
export type GroupedList = {
  header: { title: string; subtitle: string | null };
  groups: ListGroup[];
};

const DAY_ORDER: DayLabel[] = ["Today", "Yesterday", "Earlier this week", "Older"];

export function listSessionsGrouped(
  db: Db,
  sel: Selection,
  nowMs: number,
  precomputedTree?: LibraryTree,
  opts: { sort?: SortMode } = {}
): GroupedList {
  const tree = precomputedTree ?? getLibraryTree(db);
  const sort: SortMode = opts.sort ?? "time";

  let items: ListItem[] = [];
  let header: { title: string; subtitle: string | null } = { title: "All sessions", subtitle: null };

  const toItem = (s: LibrarySession, workdirLabel: string): ListItem => ({
    id: s.id, title: s.title, workdirLabel,
    lastActivity: s.lastActivity, messageCount: s.messageCount, compactCount: s.compactCount,
    costUsd: s.costUsd,
  });

  if ("repo" in sel) {
    const repo = tree.repos.find((r) => r.repoId === sel.repo);
    if (repo) {
      header = { title: repo.displayName, subtitle: repo.remote };
      items = repo.workdirs.flatMap((w) => w.sessions.map((s) => toItem(s, w.label)));
    }
  } else if ("workdir" in sel) {
    for (const r of tree.repos) {
      const w = r.workdirs.find((x) => x.path === sel.workdir);
      if (w) { header = { title: w.label, subtitle: r.displayName }; items = w.sessions.map((s) => toItem(s, w.label)); break; }
    }
  } else if ("topic" in sel) {
    const set = new Set(sel.topicIds);
    header = { title: sel.topicName, subtitle: `${sel.topicIds.length} sessions · topic` };
    items = tree.repos.flatMap((r) => r.workdirs.flatMap((w) => w.sessions.filter((s) => set.has(s.id)).map((s) => toItem(s, w.label))));
  } else {
    header = { title: sel.mode === "recent" ? "Recent" : "All sessions", subtitle: null };
    items = tree.repos.flatMap((r) => r.workdirs.flatMap((w) => w.sessions.map((s) => toItem(s, w.label))));
  }

  // Cost / messages sort: one flat ranked list (the day buckets only make sense for time).
  if (sort === "cost") {
    items.sort((a, b) => b.costUsd - a.costUsd || (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
    return { header, groups: items.length ? [{ label: "Most expensive", items }] : [] };
  }
  if (sort === "messages") {
    items.sort((a, b) => b.messageCount - a.messageCount || (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
    return { header, groups: items.length ? [{ label: "Most messages", items }] : [] };
  }

  items.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));

  if ("mode" in sel && sel.mode === "recent") {
    return { header, groups: [{ label: "Recent", items: items.slice(0, 25) }] };
  }

  const buckets = new Map<DayLabel, ListItem[]>();
  for (const it of items) {
    const b = dayBucket(it.lastActivity, nowMs);
    const list = buckets.get(b);
    if (list) list.push(it);
    else buckets.set(b, [it]);
  }
  const groups: ListGroup[] = DAY_ORDER
    .filter((l) => buckets.has(l))
    .map((l) => ({ label: l, items: buckets.get(l)! }));
  return { header, groups };
}
