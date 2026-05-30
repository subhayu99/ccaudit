# ccaudit

**Browse, search, and audit your Claude Code session history — as a warm, Obsidian-style knowledge base in your browser.**

Claude Code stores every session as JSONL under `~/.claude/projects/`. Over time that becomes thousands of conversations scattered across clones, git worktrees, and one-off directories — and `/compact` quietly buries earlier history. `ccaudit` indexes all of it into a local SQLite database and gives you a fast, three-pane reader to actually find and re-read what happened.

Everything runs **locally**. Nothing leaves your machine.

---

## Quick start

```bash
npx ccaudit            # index + open the browser UI (http://127.0.0.1:4321)
```

Or install globally:

```bash
npm install -g ccaudit
ccaudit                # serve (default)
```

First run indexes `~/.claude/projects/`; subsequent runs only re-read changed files.

## What you get

- **Repo-first browsing.** Sessions are grouped by the *logical repository* they belong to — not the accidental directory path. Clones and Conductor worktrees of the same codebase collapse into one repo (see *Repo identity* below), with deleted worktrees shown but clearly marked.
- **3-pane shell.** Sidebar tree (repo → workdir → session) · date-grouped session list · a clean transcript reader with a **Resume** command for the exact original working directory.
- **⌘K command palette.** Fuzzy-jump to any repo, workdir, or session, or fall through to full-text search.
- **Full-text search** with three modes: smart (FTS5 stemming + ranking), exact substring, and regex.
- **Graph view** (Obsidian-style): repo → workdir → session, or the folder/project pivot, with zoom-to-fit.
- **Dashboard**: activity heatmap + tool-usage breakdown.
- **De-noised transcripts**: Conductor `<system_instruction>` preambles, claude-mem observer wrappers, and slash-command echoes are stripped so titles and the reader show the real conversation. Originals are always preserved.
- **Hide directories** you don't care about (e.g. observer sessions) from every view — lossless and instant.
- **Warm-obsidian theme**, dark-first with a light (parchment) toggle. Responsive down to mobile.

## CLI

```
ccaudit                       # serve the browser UI (default).  --port <n>  --no-open
ccaudit reindex [--force]     # rebuild the SQLite index from ~/.claude/projects/
ccaudit list [--project d]    # list indexed sessions in a table   --limit <n>
ccaudit search <query>        # full-text search from the terminal  --limit <n>
ccaudit doctor                # diagnose the index db + access to ~/.claude/projects/
ccaudit mcp                   # MCP stdio server exposing session-history query tools
```

## MCP server

`ccaudit mcp` exposes your indexed history to any MCP client (e.g. Claude Desktop) with tools to list, search, and fetch sessions plus index stats — so an agent can query your own past work.

## How it works

- **Indexer** walks `~/.claude/projects/`, parses each JSONL session, and stores sessions + messages in SQLite (`~/.ccaudit/index.db`), with an FTS5 virtual table for search.
- **Repo identity (deterministic).** Identity rests only on things that are intrinsic, immutable, and shared — i.e. **git commit hashes**. At index time, while a directory still exists, ccaudit captures a bounded set of its commit hashes (+ a credential-stripped remote). Working directories that share any commit hash are unioned into one repo via union-find. Shallow clones (no root commit) still match on recent commits. No VCS → no provable cross-copy identity (and none is invented). Captured remotes are **always stripped of embedded credentials**.

## Tech

Astro 5 SSR (Node standalone) · better-sqlite3 + FTS5 · Tailwind v4 · d3-force · `@modelcontextprotocol/sdk` · tsup CLI. Tests with Vitest.

## Privacy

Local-only. The index lives at `~/.ccaudit/`. ccaudit reads `~/.claude/projects/` but never writes to it, and never sends anything over the network. If a git config on disk contains a plaintext token, ccaudit strips it before storing/displaying the remote — but you should still rotate any token found in plaintext.

---

Design notes live in [`docs/superpowers/specs/`](https://github.com/subhayu99/ccaudit/tree/main/docs/superpowers/specs) in the repository (not shipped in the npm package).
