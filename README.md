<div align="center">

<img src="https://raw.githubusercontent.com/subhayu99/ccaudit/main/public/logo.png" alt="ccaudit logo" width="116" />

# ccaudit

**Browse, search, and audit your Claude Code session history — as a warm, Obsidian-style knowledge base in your browser.**

[![npm](https://img.shields.io/npm/v/@subhayu99/ccaudit.svg?color=cf9152)](https://www.npmjs.com/package/@subhayu99/ccaudit)
&nbsp;[![license: MIT](https://img.shields.io/badge/license-MIT-d2a85f.svg)](./LICENSE)
&nbsp;[![node >= 22.5](https://img.shields.io/badge/node-%3E%3D22.5-7fae7a.svg)](https://nodejs.org)
&nbsp;![zero native deps](https://img.shields.io/badge/native%20deps-zero-7fae7a.svg)
&nbsp;![core runs offline](https://img.shields.io/badge/core-100%25%20offline-cf9152.svg)

<img src="https://raw.githubusercontent.com/subhayu99/ccaudit/main/docs/demo.gif" alt="ccaudit demo" width="100%" />

<sub>Demo recorded over a synthetic dataset — no real conversations shown.</sub>

</div>

---

Claude Code stores every session as JSONL under `~/.claude/projects/`. Over time that becomes thousands of conversations scattered across clones, git worktrees, and one-off directories — and `/compact` quietly buries earlier history. **ccaudit** indexes all of it into a local SQLite database and gives you a fast reader to actually find, re-read, and make sense of what happened.

Everything runs **locally**, with **zero native dependencies** — the same on macOS, Linux, and Windows, on any Node 22.5+. Nothing leaves your machine unless you opt into the [AI features](#privacy).

## Contents

- [Quick start](#quick-start)
- [What you'd use it for](#what-youd-use-it-for)
- [What you get](#what-you-get)
- [CLI](#cli)
- [Connect to Claude Code (MCP)](#connect-to-claude-code-mcp)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Quick start

> Published on npm as **`@subhayu99/ccaudit`** (the bare name `ccaudit` was already taken). The installed command is just **`ccaudit`**.

```bash
npx @subhayu99/ccaudit   # index + open the browser UI (http://127.0.0.1:4321)
```

Or install globally so the `ccaudit` command is on your `PATH`:

```bash
npm install -g @subhayu99/ccaudit   # note the -g
ccaudit                  # serve (default)
```

> **Requirements: Node 22.5+ — that's it.** ccaudit has **no native dependencies**: its database is Node's built-in SQLite (`node:sqlite`), so there's nothing to compile and no platform-specific binaries to match. It runs identically on macOS, Linux, and Windows. (On Node 22.5–23.3 it transparently enables Node's `--experimental-sqlite` flag for you; Node 24+ needs nothing.)

First run indexes `~/.claude/projects/`; subsequent runs only re-read changed files (an append-only fast path keeps reindex in the tens of milliseconds). Already have it running? `ccaudit open` just opens the browser without re-indexing. Hit a snag? See [Troubleshooting](#troubleshooting).

## What you'd use it for

ccaudit is the layer between you and the pile of JSONL Claude Code leaves behind. A few of the ways people actually reach for it:

**Get back what `/compact` buried.** When Claude Code compacts a long session, earlier turns drop out of the live context — but the original JSONL still has them. Open the session in the reader (or hit **⤓ Load entire conversation**) to recover the decision, snippet, or error message you lost.

**Audit your AI spend.** The dashboard totals estimated spend and tokens, with per-session cost pills and averages ($/session, messages/session, active days). Sort the list by highest cost and scope it to a date range to see which projects and sessions are actually burning tokens.

**Re-learn a repo you've forgotten.** Sessions are grouped by the *logical repository* they belong to — clones and worktrees of the same codebase collapse into one. Open a repo and read its history end-to-end to remember how a feature was built and why, instead of spelunking through `git log` alone.

**Find a past solution instead of re-deriving it.** Full-text search (smart / exact / regex) and the ⌘K palette search every message across every session. *"How did I wire up the auth flow?"* becomes a query, not an afternoon.

**Give your coding agent long-term memory.** Connect ccaudit as an MCP server and Claude Code can search and read your own past sessions mid-task — turning months of buried work into a tool your agent can call. See [Connect to Claude Code](#connect-to-claude-code-mcp).

**Run a weekly or monthly review.** Set the date range to 7d / 30d / a custom span, then skim topics, the activity heatmap, and the tool-usage breakdown to see what you actually shipped.

**Curate it into a knowledge base.** AI-name untitled sessions in one click, cluster everything into topics, and hide noisy directories or one-off experiments — losslessly — so what's left reads like a tidy archive.

**Pick up exactly where you left off.** Every session has a **Resume** command that re-launches Claude Code in the exact original working directory — no hunting for which folder it was.

## What you get

- **Repo-first browsing.** Sessions are grouped by the *logical repository* they belong to — not the accidental directory path. Clones and worktrees of the same codebase collapse into one repo (see *Repo identity* below); deleted worktrees are shown but clearly marked.
- **3-pane shell.** Sidebar tree (repo → folder → session) · session list · a clean transcript reader with a **Resume** command that drops you back in the exact original working directory. Both side panels collapse to an icon rail to give the reader the full width.
- **Unified graph view** (Obsidian-style). One force-directed graph of your whole history with a floating **Display** panel to toggle repos / folders / sessions / topics on the fly — hidden layers reconnect through so the graph stays whole. Hover to focus a node and its neighbours, drag, scroll to zoom, click to open. Topics linked from sessions across different repos become cross-cutting connectors.
- **⌘K command palette.** Live, grouped, collapsible search across every session without leaving the page — matches message content, session titles, and IDs.
- **Full-text search** in three modes: smart (FTS5 stemming + ranking), exact substring, and regex — results grouped by session and expandable inline.
- **Ask your history** *(AI, optional)*. Pose a question and get a cited answer synthesized over your most relevant past sessions. Like topic clustering and session titling, this uses the local `claude` CLI — see [Privacy](#privacy).
- **Topics.** AI-clustered themes across your sessions, scoped to the active date range, browsable from the sidebar and woven into the graph.
- **AI session titles.** One-click **Smart-name** for untitled sessions, **Name running** to (re)title the sessions you have open right now, or **Re-name all** — and bulk renames always do the live sessions first. Plus a per-session ✨ to regenerate and ✎ to edit a title by hand.
- **Dashboard.** Total spend, token totals, **averages** ($/session, messages/session, active days), the history span, an activity heatmap, and a tool-usage breakdown.
- **Cost tracking.** Per-session estimated AI spend pills; sort the list by most recent, highest cost, or most messages.
- **Global date-range filter.** All / last 7d / last 30d / a custom calendar range — scopes the list, search, graph, topics, and dashboard at once.
- **Hide the noise.** Hide whole directories, individual sessions, or reusable phrase/regex rules from every view — lossless and instant; manage them all on the Hidden page.
- **Faithful transcripts.** GitHub-flavored markdown including tables, syntax-highlighted code, and grouped tool calls. Conductor `<system_instruction>` preambles, claude-mem observer wrappers, and slash-command echoes are stripped so titles and the reader show the real conversation — originals are always preserved.
- **Export a transcript.** Download any session as clean **Markdown** or a self-contained **HTML** file from the reader (or `ccaudit export`) — the readable conversation by default, tool calls included with `--raw`.
- **Warm-obsidian theme**, dark-first with a light (parchment) toggle. Responsive down to mobile.

## CLI

```
ccaudit                       # serve the browser UI (default).  --port <n>  --no-open
ccaudit start                 # run the UI in the background (survives the terminal) and open it
ccaudit stop                  # stop the background server          ccaudit status  # is it running?
ccaudit open                  # open the UI in your browser — reuses a running instance (no re-index)
ccaudit export <id>           # save a session transcript to Markdown/HTML  --format md|html  --raw  --out <path>
ccaudit reindex [--force]     # rebuild the SQLite index from ~/.claude/projects/
ccaudit list [--project d]    # list indexed sessions in a table   --limit <n>
ccaudit search <query>        # full-text search from the terminal  --limit <n>
ccaudit stats                 # index summary stats + top tool usage
ccaudit topics                # list AI-clustered topics with session counts
ccaudit name [--force]        # generate titles for untitled sessions via `claude -p` (haiku)
ccaudit doctor                # diagnose the index db + access to ~/.claude/projects/
ccaudit mcp                   # MCP stdio server.  --install / --uninstall registers it with Claude Code
ccaudit live                  # show running (and recently-ended) Claude Code sessions
ccaudit watch --install       # (macOS) background watcher so running sessions survive restarts
                              #   --uninstall  --status
```

> **Running it persistently:** `ccaudit` (or `ccaudit start`) serves the UI; `start` detaches so it
> keeps running after you close the terminal (`ccaudit stop` to end it). `ccaudit open` just opens the
> browser to an already-running instance without re-indexing.

## Connect to Claude Code (MCP)

ccaudit ships a [Model Context Protocol](https://modelcontextprotocol.io) stdio server over your local index, so any MCP client (Claude Code, Claude Desktop, Cursor, …) can search and read your past Claude Code work — turning months of buried sessions into a tool your agent can actually call. Read-only and 100% local.

**Easiest — one click from the app.** Open ccaudit and click **Connect** under *Claude Code* in the sidebar footer. It asks your `claude` CLI to register ccaudit for you; click again any time to disconnect.

**Or one command from the terminal:**

```bash
ccaudit mcp --install     # asks first, then registers ccaudit with Claude Code (user scope)
ccaudit mcp --uninstall   # remove it
```

Both delegate to your own `claude` CLI (`claude mcp add … --scope user`), so the config is written correctly on macOS, Linux, and Windows. If `claude` isn't on your `PATH`, ccaudit prints the exact command to paste instead.

**Manual** — Claude Code:

```bash
claude mcp add ccaudit -- npx -y @subhayu99/ccaudit mcp
```

…or Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ccaudit": { "command": "npx", "args": ["-y", "@subhayu99/ccaudit", "mcp"] }
  }
}
```

**Tools exposed:**

| Tool | What it does |
|------|--------------|
| `search_sessions` | Full-text search across every message — `fts` (smart, default), `exact`, or `regex` |
| `list_sessions`   | Recent sessions, newest first; optional project filter |
| `get_session`     | A session's metadata and (optionally) its full conversation, noise filtered |
| `get_messages`    | Messages by author — `user`, `assistant`, `tool`, or `agent` (sub-agent turns) — in one session or across all of them, with an optional `contains` filter |
| `index_stats`     | Corpus-wide stats — session/message counts, spend, date span |

Then just ask: *"Search my ccaudit history for when I set up the auth flow"* or *"What did I decide about the DB schema last month?"* — and Claude answers from your own past sessions. (After connecting, restart Claude Code or run `/mcp` to load the tools.)

## Configuration

ccaudit works with zero config. To override the defaults, set these before running:

| Variable | Default | What it controls |
|----------|---------|------------------|
| `CCAUDIT_PROJECTS_DIR` | `~/.claude/projects` | Where Claude Code stores session JSONL — point elsewhere to index a different location |
| `CCAUDIT_HOME` | `~/.ccaudit` | Where ccaudit keeps its index (`index.db`), config, exports, and logs |
| `CCAUDIT_SESSIONS_DIR` | `~/.claude/sessions` | The live-session registry read by `ccaudit live` |

The server port is `--port <n>` on `serve`/`open` (default `4321`). The UI always binds to `127.0.0.1` — localhost only, never exposed to the network.

## How it works

- **Indexer** walks `~/.claude/projects/`, parses each JSONL session, and stores sessions + messages in a local SQLite database (`~/.ccaudit/index.db`) via Node's built-in `node:sqlite`, with an FTS5 virtual table for search.
- **Repo identity (deterministic).** Identity rests only on things that are intrinsic, immutable, and shared — i.e. **git commit hashes**. At index time, while a directory still exists, ccaudit captures a bounded set of its commit hashes (plus a credential-stripped remote). Working directories that share any commit hash are unioned into one repo via union-find. Shallow clones (no root commit) still match on recent commits. No VCS → no provable cross-copy identity (and none is invented). Captured remotes are **always stripped of embedded credentials**.

## Tech

Astro 5 SSR (Node standalone) · **`node:sqlite`** (Node's built-in SQLite) + FTS5 · Tailwind v4 · d3-force · `@modelcontextprotocol/sdk` · tsup CLI. Tested with Vitest. **No native dependencies.**

## Privacy

**The core is fully local and offline.** Indexing, browsing, search, the graph, the dashboard, and the MCP server never touch the network — the index lives at `~/.ccaudit/`, and ccaudit reads `~/.claude/projects/` **read-only** (it never writes there).

**The optional AI features are the exception.** Session titling (`ccaudit name`), topic clustering, AI thread names, and *Ask your history* shell out to the `claude` CLI on your machine — which sends the relevant session content to Anthropic's API, exactly as Claude Code itself does. They run **only when you explicitly invoke them**; ignore them and ccaudit stays entirely offline.

If a git config on disk contains a plaintext token, ccaudit strips it before storing or displaying the remote — but you should still rotate any token found in plaintext.

## Troubleshooting

- **`ccaudit: command not found`** — a *local* `npm install @subhayu99/ccaudit` (without `-g`) only puts the binary in `./node_modules/.bin`, never on your `PATH`. Use `npx @subhayu99/ccaudit` (zero-install), install globally with `npm install -g @subhayu99/ccaudit`, or run the local copy with `npx ccaudit` from that project directory.
- **Node version** — ccaudit needs **Node ≥ 22.5** for built-in `node:sqlite`. On 22.5–23.3 it enables `--experimental-sqlite` for you; Node 24+ needs nothing. Older Node exits with an upgrade hint (`nvm install 24`).
- **Port already in use** — ccaudit tells you exactly what's holding the port and suggests a free one. Pass `--port <n>` to pick another.
- **AI features seem to do nothing** — titling, clustering, topics, and *Ask* shell out to the `claude` CLI. Install Claude Code and make sure `claude` is on your `PATH`. Everything else works without it.
- **Linux/Windows: running sessions show, but "recently ended" stays empty** — recording *when* a session ends relies on a background watcher that's currently macOS-only. Running (live) sessions are detected on every platform; the recently-ended list just won't populate elsewhere yet.
- **Something looks off with the index** — run `ccaudit doctor` to check the database and read access to `~/.claude/projects/`, or `ccaudit reindex --force` to rebuild from scratch.

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
