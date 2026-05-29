import type Database from "better-sqlite3";
import { listWorkdirs } from "./workdirs.js";
import { computeRepoComponents } from "../identity/components.js";
import { exclusionCondition } from "./exclusions.js";
import { cleanPromptText } from "../lib/clean-prompt.js";

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
};

export function getLibraryTree(db: Database.Database): LibraryTree {
  const workdirs = listWorkdirs(db);
  const { repos, repoByPath } = computeRepoComponents(workdirs);
  const existsByPath = new Map(workdirs.map((w) => [w.path, w.existsOnDisk]));

  const excl = exclusionCondition(db);
  const rows = db
    .prepare(
      `SELECT id, cwd, ai_title, first_prompt, last_activity AS last_activity,
              message_count AS message_count, compact_count AS compact_count
         FROM sessions
        WHERE cwd IS NOT NULL AND ${excl.sql}
        ORDER BY last_activity DESC`
    )
    .all(excl.params) as LibRow[];

  // group sessions by workdir path
  const byWorkdir = new Map<string, LibrarySession[]>();
  for (const r of rows) {
    const s: LibrarySession = {
      id: r.id, title: titleOf(r.ai_title, r.first_prompt, r.id),
      lastActivity: r.last_activity, messageCount: r.message_count,
      compactCount: r.compact_count, workdirPath: r.cwd,
    };
    byWorkdir.set(r.cwd, [...(byWorkdir.get(r.cwd) ?? []), s]);
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
  | { mode: "recent" | "all" };

export type ListItem = {
  id: string; title: string; workdirLabel: string;
  lastActivity: number | null; messageCount: number; compactCount: number;
};
export type ListGroup = { label: DayLabel | "Recent"; items: ListItem[] };
export type GroupedList = {
  header: { title: string; subtitle: string | null };
  groups: ListGroup[];
};

const DAY_ORDER: DayLabel[] = ["Today", "Yesterday", "Earlier this week", "Older"];

export function listSessionsGrouped(
  db: Database.Database,
  sel: Selection,
  nowMs: number
): GroupedList {
  const tree = getLibraryTree(db);

  let items: ListItem[] = [];
  let header: { title: string; subtitle: string | null } = { title: "All sessions", subtitle: null };

  const toItem = (s: LibrarySession, workdirLabel: string): ListItem => ({
    id: s.id, title: s.title, workdirLabel,
    lastActivity: s.lastActivity, messageCount: s.messageCount, compactCount: s.compactCount,
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
  } else {
    header = { title: sel.mode === "recent" ? "Recent" : "All sessions", subtitle: null };
    items = tree.repos.flatMap((r) => r.workdirs.flatMap((w) => w.sessions.map((s) => toItem(s, w.label))));
  }

  items.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));

  if ("mode" in sel && sel.mode === "recent") {
    return { header, groups: [{ label: "Recent", items: items.slice(0, 25) }] };
  }

  const buckets = new Map<DayLabel, ListItem[]>();
  for (const it of items) {
    const b = dayBucket(it.lastActivity, nowMs);
    buckets.set(b, [...(buckets.get(b) ?? []), it]);
  }
  const groups: ListGroup[] = DAY_ORDER
    .filter((l) => buckets.has(l))
    .map((l) => ({ label: l, items: buckets.get(l)! }));
  return { header, groups };
}
