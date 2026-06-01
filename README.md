<div align="center">

<img src="https://raw.githubusercontent.com/subhayu99/ccaudit/main/public/logo.png" alt="ccaudit logo" width="116" />

# ccaudit

**Browse, search, and audit your Claude Code session history — as a warm, Obsidian-style knowledge base in your browser.**

[![npm](https://img.shields.io/npm/v/@subhayu99/ccaudit.svg?color=cf9152)](https://www.npmjs.com/package/@subhayu99/ccaudit)
&nbsp;[![license: MIT](https://img.shields.io/badge/license-MIT-d2a85f.svg)](./LICENSE)
&nbsp;[![node >= 20](https://img.shields.io/badge/node-%3E%3D20-7fae7a.svg)](https://nodejs.org)
&nbsp;![core runs offline](https://img.shields.io/badge/core-100%25%20offline-cf9152.svg)

<img src="https://raw.githubusercontent.com/subhayu99/ccaudit/main/docs/demo.gif" alt="ccaudit demo" width="100%" />

<sub>Demo recorded over a synthetic dataset — no real conversations shown.</sub>

</div>

---

Claude Code stores every session as JSONL under `~/.claude/projects/`. Over time that becomes thousands of conversations scattered across clones, git worktrees, and one-off directories — and `/compact` quietly buries earlier history. **ccaudit** indexes all of it into a local SQLite database and gives you a fast reader to actually find, re-read, and make sense of what happened.

Everything runs **locally**. Nothing leaves your machine.

## Quick start

> Published on npm as **`@subhayu99/ccaudit`** (the bare name `ccaudit` was already taken). The installed command is just **`ccaudit`**.

```bash
npx @subhayu99/ccaudit   # index + open the browser UI (http://127.0.0.1:4321)
```

Or install globally:

```bash
npm install -g @subhayu99/ccaudit
ccaudit                  # serve (default)
```

First run indexes `~/.claude/projects/`; subsequent runs only re-read changed files (an append-only fast path keeps reindex in the tens of milliseconds).

## What you get

- **Repo-first browsing.** Sessions are grouped by the *logical repository* they belong to — not the accidental directory path. Clones and worktrees of the same codebase collapse into one repo (see *Repo identity* below); deleted worktrees are shown but clearly marked.
- **3-pane shell.** Sidebar tree (repo → folder → session) · session list · a clean transcript reader with a **Resume** command that drops you back in the exact original working directory. Both side panels collapse to an icon rail to give the reader the full width.
- **Unified graph view** (Obsidian-style). One force-directed graph of your whole history with a floating **Display** panel to toggle repos / folders / sessions / topics on the fly — hidden layers reconnect through so the graph stays whole. Hover to focus a node and its neighbours, drag, scroll to zoom, click to open. Topics linked from sessions across different repos become cross-cutting connectors.
- **⌘K command palette.** Live, grouped, collapsible search across every session without leaving the page.
- **Full-text search** in three modes: smart (FTS5 stemming + ranking), exact substring, and regex — results grouped by session and expandable inline.
- **Ask your history** *(AI, optional)*. Pose a question and get a cited answer synthesized over your most relevant past sessions. Like topic clustering and session titling, this uses the local `claude` CLI — see [Privacy](#privacy).
- **Topics.** AI-clustered themes across your sessions, scoped to the active date range, browsable from the sidebar and woven into the graph.
- **Dashboard.** Total spend, token totals, **averages** ($/session, messages/session, active days), the history span, an activity heatmap, and a tool-usage breakdown.
- **Cost tracking.** Per-session estimated AI spend pills; sort the list by most recent, highest cost, or most messages.
- **Global date-range filter.** All / last 7d / last 30d / a custom calendar range — scopes the list, search, graph, topics, and dashboard at once.
- **Hide the noise.** Hide whole directories, individual sessions, or reusable phrase/regex rules from every view — lossless and instant; manage them all on the Hidden page.
- **Faithful transcripts.** GitHub-flavored markdown including tables, syntax-highlighted code, and grouped tool calls. Conductor `<system_instruction>` preambles, claude-mem observer wrappers, and slash-command echoes are stripped so titles and the reader show the real conversation — originals are always preserved.
- **Warm-obsidian theme**, dark-first with a light (parchment) toggle. Responsive down to mobile.

## CLI

```
ccaudit                       # serve the browser UI (default).  --port <n>  --no-open
ccaudit reindex [--force]     # rebuild the SQLite index from ~/.claude/projects/
ccaudit list [--project d]    # list indexed sessions in a table   --limit <n>
ccaudit search <query>        # full-text search from the terminal  --limit <n>
ccaudit stats                 # index summary stats + top tool usage
ccaudit topics                # list AI-clustered topics with session counts
ccaudit name [--force]        # generate titles for untitled sessions via `claude -p` (haiku)
ccaudit doctor                # diagnose the index db + access to ~/.claude/projects/
ccaudit mcp                   # MCP stdio server exposing session-history query tools
```

## MCP server

`ccaudit mcp` exposes your indexed history to any MCP client (e.g. Claude Desktop) with tools to list, search, and fetch sessions plus index stats — so an agent can query your own past work.

## How it works

- **Indexer** walks `~/.claude/projects/`, parses each JSONL session, and stores sessions + messages in SQLite (`~/.ccaudit/index.db`), with an FTS5 virtual table for search.
- **Repo identity (deterministic).** Identity rests only on things that are intrinsic, immutable, and shared — i.e. **git commit hashes**. At index time, while a directory still exists, ccaudit captures a bounded set of its commit hashes (plus a credential-stripped remote). Working directories that share any commit hash are unioned into one repo via union-find. Shallow clones (no root commit) still match on recent commits. No VCS → no provable cross-copy identity (and none is invented). Captured remotes are **always stripped of embedded credentials**.

## Tech

Astro 5 SSR (Node standalone) · better-sqlite3 + FTS5 · Tailwind v4 · d3-force · `@modelcontextprotocol/sdk` · tsup CLI. Tested with Vitest.

## Privacy

**The core is fully local and offline.** Indexing, browsing, search, the graph, the dashboard, and the MCP server never touch the network — the index lives at `~/.ccaudit/`, and ccaudit reads `~/.claude/projects/` **read-only** (it never writes there).

**The optional AI features are the exception.** Session titling (`ccaudit name`), topic clustering, AI thread names, and *Ask your history* shell out to the `claude` CLI on your machine — which sends the relevant session content to Anthropic's API, exactly as Claude Code itself does. They run **only when you explicitly invoke them**; ignore them and ccaudit stays entirely offline.

If a git config on disk contains a plaintext token, ccaudit strips it before storing or displaying the remote — but you should still rotate any token found in plaintext.

## Development

```bash
npm install        # also builds the CLI + web app via the prepare script
npm test           # Vitest
npm run typecheck  # astro check && tsc --noEmit
npm run build      # tsup (CLI → dist/) + astro build (web → dist-web/)
npm run dev        # run the CLI from source via tsx
```

Design notes live in [`docs/superpowers/specs/`](https://github.com/subhayu99/ccaudit/tree/main/docs/superpowers/specs) (not shipped in the npm package).

---

<sub>Not affiliated with Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, PBC; ccaudit is an independent tool that reads the local session logs Claude Code writes on your machine.</sub>

## License

[MIT](./LICENSE) © subhayu99
