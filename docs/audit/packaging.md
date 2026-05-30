# ccaudit — Packaging & Publish-Readiness Audit

Scope: `npm publish` readiness as a package + CLI. Verified with `npm pack --dry-run`
on 2026-05-30. Current state: **`npm publish` would produce a broken package** — the
browser UI cannot start for an end user. Details below.

---

## P0 — Blocking / correctness

### P0.1 — `serve` shells out to `npx astro dev`; published package can't serve the UI
- `src/cli/serve.ts:36` — `spawn("npx", ["astro", "dev", "--port", port, ...], { cwd: root })`.
- `astro` is a **devDependency** (`package.json:48` is tailwind, astro is in `dependencies` actually at :26 — but `@astrojs/check`, `tsx`, `tailwindcss`, `@tailwindcss/vite` are dev). `astro dev` runs the Vite dev server against **source `.astro`/`.ts` files**, recompiling Tailwind on the fly. For a globally-installed/`npx` user this means: (a) it depends on the full source tree being present, (b) it runs an unbundled dev server (slow, not production), (c) `@tailwindcss/vite` is a devDependency so Tailwind won't even load. The whole `dist-web/` standalone build (`astro.config.mjs:10`, `output:"server"` + `@astrojs/node` standalone) is **never referenced anywhere in `src/`** (`grep dist-web src/` → 0 hits). You built a production server and then never run it.
- Fix: serve the standalone build. `serveCommand` should `import` / spawn `node <pkgRoot>/dist-web/server/entry.mjs` with `HOST`/`PORT` env (Astro node-standalone reads `HOST`/`PORT`). Resolve the entry relative to the bundled CLI (`fileURLToPath(import.meta.url)` → up to package root) instead of `findProjectRoot()` which hunts for `astro.config.mjs` (won't exist in a published tarball reliably, and you don't want it to). Keep `astro dev` only behind a `--dev` flag for local hacking. Effort: **M**

### P0.2 — `dist-web/` (the standalone server) is excluded from the published tarball
- No `.npmignore`; `npm` falls back to `.gitignore` (warned by `npm pack`). `.gitignore` lists `dist/` and `dist-web/`. There is **no `files` field** in `package.json`. Net effect from `npm pack --dry-run`: tarball includes `dist/index.js` (only because `prepare` regenerates it after clean), **all 58 `src/*.ts` files**, and **490KB of `docs/superpowers/` design specs+PNGs** — but **NOT `dist-web/`**. So even after fixing P0.1, the server build isn't shipped.
- Verified: 107 files, 360KB packed / 794KB unpacked; `dist-web` absent.
- Fix: add a `"files"` allowlist to `package.json`: `["dist/", "dist-web/", "public/", "README.md", "LICENSE"]`. This single change both ships the server build and drops the 58 source files + design docs. Effort: **S**

### P0.3 — `prepare` only builds the CLI, not the web app
- `package.json:18` — `"prepare": "tsup"`. `prepare` runs on `npm install` (incl. from git) and before `npm publish`. It builds `dist/index.js` but **never runs `astro build`**, so `dist-web/` is whatever stale artifact happens to be on disk (or absent in CI/a fresh clone). Combined with P0.2 this means a publish from a clean checkout ships **no web build at all**.
- Fix: `"build": "tsup && astro build"` and `"prepare": "npm run build"` (or `"prepacked"`/`"prepublishOnly": "npm run build"`). Make `astro build` part of the canonical build so `dist-web/` is always fresh at publish. Effort: **S**

### P0.4 — `dist/` currently contains a stale stray Astro build (`dist/client`, `dist/server`)
- `ls dist/` shows `index.js` **plus** `client/` and `server/` — leftover from before `astro.config.mjs:10` moved Astro output to `dist-web/`. `tsup` has `clean:true` (`tsup.config.ts:8`) so it'd wipe these on next build, but they're currently shipped (they pre-date the `prepare` clean only if order differs). Harmless once `files` (P0.2) is set, but indicates the two-output split isn't fully settled.
- Fix: confirm `tsup clean` removes them; once `files` allowlists explicit paths this is moot. Effort: **S**

### P0.5 — `better-sqlite3` native module + `astro dev` SSR-external assumption
- `astro.config.mjs:16` marks `better-sqlite3` as SSR-external. The standalone server (`dist-web/`) will `require` it from `node_modules` at runtime — fine, it's a `dependency` (`package.json:27`). But `better-sqlite3` needs prebuilt binaries for the user's Node ABI; `npm install -g ccaudit` triggers its `prebuild-install`. Add an explicit note/`engines` guard. `engines.node:">=20"` (`package.json:21`) is good but doesn't pin an ABI. Low risk but worth a `doctor` check that `better-sqlite3` loads. Effort: **S**

---

## P1 — UX / quality / publish hygiene

### P1.1 — `version` is `0.0.1` — signal it's pre-release or bump to a real version
- `package.json:3`. `0.0.1` as a first publish is fine but unconventional; consider `0.1.0`. If publishing previews, add `"publishConfig": { "access": "public" }` is unneeded (unscoped) but a `"prerelease"` tag workflow helps. Effort: **S**

### P1.2 — Missing `repository`, `homepage`, `bugs`, `author`, `keywords`
- `package.json` has none of these. npm shows "repository: unknown", no source link, no discoverability. README references `docs/superpowers/specs/` which won't ship (and shouldn't).
- Fix: add `"repository": { "type":"git", "url":"git+https://github.com/<user>/ccaudit.git" }`, `"homepage"`, `"bugs"`, `"author"`, and `"keywords": ["claude-code","cli","sqlite","session-history","audit","mcp"]`. Effort: **S**

### P1.3 — `license: "MIT"` declared but no LICENSE file
- `package.json:54` says MIT; no `LICENSE` file in repo (not in `ls -la` root). npm/GitHub won't surface the license text; some registries flag it.
- Fix: add a `LICENSE` file (MIT, with author/year) and include it via the `files` allowlist. Effort: **S**

### P1.4 — `findProjectRoot()` will fail in the published layout
- `src/cli/serve.ts:11-18` walks up 10 dirs looking for `astro.config.mjs`. In a published tarball with the P0.2 `files` allowlist, `astro.config.mjs` is intentionally NOT shipped (it's build-time config). Even today it's shipped only by the `.gitignore` fallback accident. This couples runtime to a build file. Once P0.1 serves `dist-web/server/entry.mjs`, delete `findProjectRoot` and resolve the package root from `import.meta.url`. Effort: **S** (folds into P0.1)

### P1.5 — `serve` auto-`open` uses macOS-only `open` command
- `src/cli/serve.ts:49` — `exec(\`open "${url}"\`)`. `open` is macOS-only; Linux needs `xdg-open`, Windows needs `start`. The README pitches `npx ccaudit` as the headline flow, so cross-platform first-run matters.
- Fix: branch on `process.platform` (`darwin`→`open`, `win32`→`start ""`, else→`xdg-open`), or add a tiny `open`-style helper. Guard already exists for `SSH_TTY`. Effort: **S**

### P1.6 — First-run UX: no guidance when `~/.claude/projects/` is absent
- `serveCommand` (`src/cli/serve.ts:24-33`) indexes silently; if `CLAUDE_PROJECTS_DIR` doesn't exist, `indexAll` likely yields 0 and the UI is empty with no explanation. `doctor` (`src/cli/doctor.ts:13`) detects this but `serve` doesn't surface it.
- Fix: in `serve`, if projects dir missing or 0 sessions indexed, print a clear message ("No Claude Code sessions found at <path>. Set CCAUDIT_PROJECTS_DIR or run Claude Code first.") before/instead of launching. Effort: **S**

### P1.7 — README claims "Node standalone" but standalone is never run (accuracy)
- `README.md:60` — "Astro 5 SSR (Node standalone)". True of the *build* but false of the *runtime* until P0.1 lands. Also `README.md:66` points to `docs/superpowers/specs/` which won't (and shouldn't) ship in the tarball. Otherwise README is accurate and well-matched to current features (3-pane, ⌘K, FTS modes, graph, dashboard, repo identity, MCP). Once P0.1 is fixed the standalone claim becomes true.
- Fix: keep the claim, fix P0.1; change the design-notes pointer to a GitHub link rather than a shipped path. Effort: **S**

### P1.8 — `claude -p` shell-out for labeling has no graceful absence handling at the packaging layer
- `src/labeling/label-segments.ts:28` — `execFileSync("claude", ...)`. A published-package user may not have the `claude` CLI on PATH. This is an AI-enhancement, not core, so it should fail soft. Verify the API routes that call it (`src/pages/api/label.ts`) catch ENOENT and degrade. Mention in README that thread-naming/clustering require the `claude` CLI. Effort: **S**

---

## P2 — Nice-to-have

### P2.1 — Add `engines.npm` and an `.npmrc`/`prepublishOnly` test gate
- Run `npm test` + `typecheck` in `prepublishOnly` so a broken build can't be published. Effort: **S**

### P2.2 — Trim docs from package; ship a `CHANGELOG.md`
- After P0.2 the 490KB `docs/superpowers/` specs stop shipping (good). Consider a small `CHANGELOG.md` instead, included in `files`. Effort: **S**

### P2.3 — Provenance / publish workflow
- Add a GitHub Actions release workflow with `npm publish --provenance` for supply-chain trust. Effort: **M**

### P2.4 — `bin` shebang is injected by tsup banner — verify executable bit on publish
- `tsup.config.ts:11` adds `#!/usr/bin/env node`; `dist/index.js` shows `-rwxr-xr-x`. npm preserves the bit and sets it on `bin` anyway, so this is fine — noted as already-good. Effort: **S**

### P2.5 — Path handling is solid; one documented ambiguity
- `src/paths.ts` correctly uses `homedir()`/`join()` (cross-platform) and exposes `CCAUDIT_HOME`/`CCAUDIT_PROJECTS_DIR` overrides — good. `decodeProjectDir` (`paths.ts:20`) is honestly documented as a lossy heuristic. No action; this is already good.

---

## Already good
- `engines.node: ">=20"`, `type: "module"`, ESM throughout.
- `bin` map + tsup shebang banner → working executable.
- Env overrides (`CCAUDIT_HOME`, `CCAUDIT_PROJECTS_DIR`) and `homedir()`/`join()` give clean cross-platform paths.
- README is genuinely accurate to current features (only the runtime "standalone" detail is aspirational).
- The dist/dist-web split (`astro.config.mjs:8-10`) correctly prevents tsup and astro from clobbering each other.
