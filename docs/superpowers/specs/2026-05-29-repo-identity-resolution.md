# Repo Identity Resolution — Design (first-principles)

**Date:** 2026-05-29
**Status:** Design captured; not yet implemented.

## The problem

The same logical codebase appears under many different directory paths, because of clones and **git worktrees** (e.g. Conductor creates `~/conductor/workspaces/<repo>/<city>` worktrees, later deleted). One repo — "backend" — was observed across 7 distinct directories: two plain clones (`Downloads/LoopProjects/backend`, `Downloads/backend`) and five Conductor worktrees (`conductor/workspaces/backend/{delhi,tianjin,algiers,surat/v1,vancouver}`), only 4 of which still exist on disk. Across the whole index, **only 23 of 80 directories still exist** — 57 are deleted worktrees.

Goal: group sessions by the *logical codebase* they belong to, not the accidental directory path — generically, for any user, deterministically, in a way that does not change over time. This must work as a published npm package, so **no hardcoded orgs, tools, or path conventions.**

## First-principles derivation

### What a session physically records

A session is a JSONL file. Its only durable facts are: `cwd` (a path *string*), `gitBranch` (a *label*), timestamps, and conversation text. **It records nothing that intrinsically identifies a codebase.** So identity must be obtained by inspecting the filesystem at `cwd` *while it still exists*, or it is unrecoverable.

### What "same codebase" requires

Two copies are the same codebase only if they both carry a token that is:

1. **Intrinsic** — derived from content, not assigned by a human/tool.
2. **Immutable** — fixed for all time.
3. **Shared** — identical in every copy.

Candidate tokens tested against these three:

| Candidate | Intrinsic? | Immutable? | Shared? | Verdict |
|-----------|-----------|-----------|---------|---------|
| Directory path | No (assigned) | No | No | Coordinate, not identity |
| Manifest name (`package.json` "name", etc.) | No (authored) | No | — | Assertion, not proof |
| Current file content | Yes | No (drifts as you work) | — | Probability, never proof |
| **Git commit hash** | **Yes** (hash of content+history) | **Yes** | **Yes** | **Passes all three** |

**Conclusion:** the only tokens that can *prove* shared lineage are **git commit hashes**, because a VCS is the only common system that records an immutable, content-addressed history.

### "Resolve" is union-find over shared tokens — not a single key

It is tempting to use the **root commit SHA** as a single universal key. This is wrong in general: a **shallow clone** (`git clone --depth 1`) does not contain the root commit. So a single-key model breaks.

The correct model: each workdir carries a **set** of commit hashes (the commits it locally has). Two workdirs are the same repo iff their hash-sets **intersect**. A "repo" is a **connected component** of the graph where:

- **nodes** = workdirs (each annotated with its captured immutable token-set),
- **edges** = "shares an immutable token" (a commit hash; a normalized remote URL as a weaker secondary edge),
- **repos** = the connected components (emergent, not declared).

The root commit is merely the *strongest* shared token (the universal ancestor when present). The general connector is **"any shared content-addressed history object."**

### Two hard limits that fall out of the atoms

1. **No VCS → no provable identity, ever.** If no system recorded an immutable history, there is no intrinsic-immutable-shared token to match on. This is information-theoretic, not a tooling gap: *lineage never written down cannot be recovered.* For a plain directory, the path is a unique coordinate and there is nothing to merge — and no aliasing arises without clone/worktree anyway. Anything beyond this is a **guess, and must be labelled a guess** (never promoted to truth).

2. **Tokens are observable only while the directory lives.** Commit hashes live inside `.git` at the path; the session only persisted the path. Therefore the architecture's core act is: **read the token-set while the directory exists, and persist it keyed to the session.** What was not captured before a worktree was deleted is permanently unmatchable.

## The model (derived, not prescribed)

```
 Repo  ──(instance_of: shares immutable token)──  Workdir  ──(ran_in: cwd)──  Session
(connected component)                             (a path)                    (a chat)
```

- **Repo** = a connected component of workdirs under shared-token edges. Display name from a stripped remote URL (credentials removed), else manifest name, else basename. Identity key is the component, not any single string.
- **Workdir** = an absolute path where work happened (clone / worktree / plain folder), annotated with its captured commit-hash set + normalized remote.
- **Session** = a Claude Code conversation, attached to its Workdir by the recorded `cwd`.

### Two distinct uses of the same data — must not be conflated

- **Grouping/identity** traverses `Workdir —instance_of→ Repo`.
- **Resume command** must use `Session —ran_in→ Workdir.path` — the *exact* cwd the session ran in, never the canonical repo path (resuming against the wrong worktree would drop the user in the wrong place).

### Graceful degradation

- Git, dir alive: full token-set captured → correct component membership.
- Git, dir deleted: usable only if the token-set was captured earlier while alive; else falls to inference (path/branch/content), explicitly labelled non-authoritative.
- Non-git: Repo and Workdir collapse into one node; path is identity; no aliasing to resolve.

## Security note

Git remote URLs observed on disk embed credentials (e.g. `https://user:ghp_TOKEN@github.com/org/repo`). **Any stored or displayed remote MUST be stripped of credentials** — keep only `host/org/repo`. (The user should also rotate any token found in plaintext git configs.)

## Implementation outline (Layer 1, deterministic — for a future session)

1. A pure resolver `resolveIdentity(cwd, { existsOnDisk }) → { tokens: string[], remote?: string, manifestName?: string, kind: "git" | "manifest" | "path" }`.
   - If git + alive: `git -C <cwd> rev-list HEAD` (bounded, e.g. first + last N) for the token-set; `git -C <cwd> config --get remote.origin.url` (credential-stripped); root via `git rev-list --max-parents=0 HEAD`.
2. At index time, call the resolver once per session, persist `cwd` (already stored) + the token-set + normalized remote, keyed to the session.
3. Compute Repo components via **union-find** over shared tokens (commit-hash intersection first; matching normalized remote as a secondary merge).
4. Re-pivot the existing graph view and add a "Repos" grouping that traverses components instead of paths.
5. Inference layer (path structure, AI clustering) is **optional, separate, and labelled a heuristic** — never merged into the deterministic component set.

## One-line summary

Identity = the equivalence classes formed by **shared content-addressed history tokens (git commit hashes)**; capture those tokens **while the directory still exists** and persist them; **absence of a recorded history is an absence of identity, not a problem to be solved** — only guessed at, and clearly labelled as such.
