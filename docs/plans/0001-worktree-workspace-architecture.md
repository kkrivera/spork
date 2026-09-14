# 0001 — Worktree workspace architecture

Status: Accepted

## Problem

`spork` lets a user pull several independent, unrelated git repos into one local
**workspace**: a folder holding an isolated `git worktree` checkout of each repo
(at a chosen ref), a generated VS Code `.code-workspace` file so they open as one
multi-root editor session, and a manifest describing the workspace so its layout
is reproducible. This doc records the git-worktree mechanics and package
structure needed to make that work correctly, and the tradeoffs behind them.

## Design

### Shared bare clone, unique local branch per worktree

Each repo source is cloned once, as a `git clone --bare` cache under
`~/.spork/repos/<id>/` — never re-cloned per workspace. Every worktree is created
against that shared cache via:

```
git worktree add -b spork/<workspace-slug>/<folder-slug> <path> <start-point>
```

`git worktree add <ref>` fails if `<ref>` is already checked out anywhere else.
Because the clone is *shared across workspaces*, reusing the requested branch
name directly would collide the moment two workspaces (or two worktrees in one
workspace) touch the same repo+branch — a routine scenario for this product, not
an edge case. Giving every worktree its own spork-owned local branch, derived
from the workspace and folder names, avoids that entirely. The manifest records
both the user's requested ref (what they asked to check out) and the actual local
branch (what git has checked out), so `add-repo --branch <ref>` behaves the way
users expect while the underlying git state stays collision-free.

Ref/folder names are slugified before use in derived branch/folder names (e.g. a
`feature/foo` branch must not produce a nested path).

Clones are full, not shallow — the same cache backs arbitrary future branches
over time, and shallow clones would complicate later fetches. Shallow-clone
support is a possible future optimization, not a v1 concern.

### Reconcile before mutating

Users will, in the ordinary course of things, `rm -rf` a worktree folder or an
entire workspace directory by hand instead of going through `remove-repo`/
`remove`. That leaves git's own `.git/worktrees/<name>` metadata "prunable" and
the CLI's registry pointing at a manifest entry whose path no longer exists.

`add-repo`, `remove-repo`, `list`, and `status` all run a cheap reconcile pass
before trusting cached state: `git worktree list --porcelain` + `git worktree
prune` against the repo cache, plus a filesystem existence check per manifest
entry. This is built into `core`'s orchestration layer, not left as a
per-command afterthought.

### Locking around the shared cache

Because a repo's cache is shared across workspaces, two concurrent `spork`
invocations touching the same repo (two scripted `add-repo` calls, parallel CI
jobs) can race on `git fetch`/`worktree add` against the same `.git` dir. A
per-repo-source lock (via the `proper-lockfile` package) around clone/fetch/
worktree-add mutations avoids this at low cost.

### Registry is an index, not a source of truth

`~/.spork/workspaces.json` maps a workspace name to its manifest path, so
`spork workspace list` doesn't need to scan the filesystem. Every read verifies
the manifest still exists and self-heals (drops and reports) missing entries
rather than trusting the registry blindly. Commands also accept a raw path as a
fallback when a name isn't registered — cheap insurance against registry drift.

### Package split: `core` + `cli`, not three packages

A standalone `packages/git` wrapper package was considered and rejected for v1:
it would have exactly one consumer (`core`), and a third package.json/README/
CLAUDE.md/project-reference doesn't buy real isolation at this scale. `core`
has an internal `src/git/` module instead, with `exec.ts` as the single spawn
point — that's the seam unit tests mock, giving the same testability without the
extra package.

`cli` may only import `core`'s declared `src/index.ts` exports, never reach into
`core/src/*` directly. This is enforced by TypeScript project references (see
root `tsconfig.json`), not just convention.

### Testing strategy: unit tests only, ≥80% coverage, for now

Every new feature ships with unit tests in the same change, targeting ≥80%
coverage (lines/functions/branches/statements), enforced by vitest's coverage
thresholds in CI. Anything that would spawn a real external process — actual
`git` invocations, the `code` CLI — is exercised via **mocked** exec calls, not
real subprocesses. Manifest/registry/`.code-workspace` file I/O is tested
against real temp files, since plain filesystem access isn't the kind of
external-tool-call flakiness this restriction is about.

Real-subprocess-driven integration tests are deliberately deferred to a later
phase — they're slower and more environment-dependent, and getting the unit-level
design (mockable exec seam, reconcile logic, locking) right first makes that
follow-up easier rather than harder.

### `status` is local-only

"Per-worktree status" means local dirty/branch state, not ahead/behind the
remote — that would require a network round-trip per worktree on every call,
which doesn't match the expectations set by plain `git status`. An ahead/behind
view (behind a `--fetch` flag or similar) is a later-phase concern.

### `open` uses the `code` CLI, via an injectable opener

`spork workspace open` shells out to the `code` CLI rather than OS-level `open`,
since file-association with VS Code isn't guaranteed and generic `open` behaves
unpredictably in CI/non-interactive environments. The opener is an injected
dependency so it's mockable in tests and swappable later (e.g. for a different
editor) without touching command logic. If `code` isn't found, the command
prints the workspace's `.code-workspace` path instead of failing silently.

## Explicitly deferred

Not designed in depth here — the architecture above doesn't foreclose any of
these, but they're out of scope for the v1 slice this doc accompanies:

- Deeper git/PR enrichment via the `gh`/git CLI.
- A VS Code extension.
- Swapping yarn workspaces for Nx.
- Populating each generated workspace folder with its own AI-friendly
  conventions (skills/CLAUDE.md) — the *repo* has these; workspaces `spork`
  generates for users don't yet.
- Real-subprocess integration tests.
- Repo-source identity/dedup (the same repo added via HTTPS and SSH is treated
  as two different sources today) and submodule support beyond a warning when
  `.gitmodules` is detected.
