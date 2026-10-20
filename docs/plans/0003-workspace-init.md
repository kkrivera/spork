# 0003 — `workspace init`: adopting an existing folder in place

Status: Accepted

## Problem

Every existing way of populating a workspace (`workspace create --repo`,
`workspace add-repo`) creates a fresh `git worktree` checkout on a shared
branch (the workspace's own name — see
[0001](0001-worktree-workspace-architecture.md)) from spork's managed repo
cache. That's the right model when spork is the one creating the checkout,
but wrong for "I already have a folder of repos cloned myself and just
want spork to treat it as a workspace" — a fresh worktree would mean
re-cloning, a new branch, and abandoning whatever branch/dirty state those
folders are already in.

`workspace init <name>`, run from inside that folder, fixes this: it scans
one level deep for git repos (`findGitRepoDirs`, the same scan `repo scan`
already uses), lets the user pick which join, and wires them into spork's
bookkeeping (manifest + `.code-workspace` + registry) **exactly as they
already sit on disk** — no worktree, no branch, no checkout, ever. If a
selected folder's repo isn't yet known to spork's shared cache
(`~/.spork/repos`), it gets adopted into it (`adoptLocalRepo`, unchanged),
but the folder itself is never rewired to depend on that cache.

## Design

### A real data-model distinction, not just a CLI-level check

Before this, every manifest entry (`WorktreeEntry`) was assumed to be a
real git worktree of spork's shared cache — there was no way to represent
"just a plain folder." Two new, independent fields:

- **Per-entry `kind: 'worktree' | 'adopted'`** (`WorktreeEntry`/new
  `AdoptedEntry`, unioned as `ManifestEntry`) — governs whether `removeRepo`
  does a real `git worktree remove` at all. An `AdoptedEntry` has no
  `requestedRef`/`localBranch` either: spork never asked git to check out
  anything for it, so populating those fields would misrepresent them as
  something spork controls.
- **Whole-workspace `origin: 'created' | 'initialized'`** (`WorkspaceManifest`)
  — governs whether `removeWorkspace` ever deletes the directory at all.

These are kept independent rather than inferring one from the other,
because nothing stops `add-repo` from working inside an `init`-created
workspace too (adding a real worktree-backed repo on top of adopted ones) —
that entry should still be removed the normal way even though the
workspace directory itself is still never deleted. Both fields are
optional, with today's behavior as the implicit default, so no manifest
written before this change needs migrating.

### `initWorkspace`/`adoptRepoIntoWorkspace` stay separate, like `createWorkspace`/`addRepo`

`initWorkspace` only ever writes an empty, `origin: 'initialized'` manifest
+ `.code-workspace` in place (no `mkdir` — the folder already exists with
real content). Adopting each selected folder is a second, separate step
(`adoptRepoIntoWorkspace`), mirroring exactly how `createWorkspace` and
`addRepo` are already split: the CLI command loops over selected folders
with `runConcurrently` (one call per folder, same live-dashboard pattern
`addReposBatch.ts` already uses for `--repo`), not something core itself
loops over — keeping each call independently concurrency-safe (the same
re-read-fresh-inside-the-lock pattern `addRepo`'s own tail uses).

### Removal: only ever touches spork's own bookkeeping

`removeRepo` on an `AdoptedEntry` just drops it from the manifest/
`.code-workspace` — no `resolveRepoCache`/`withRepoLock`/`removeWorktree`
call, since there's no worktree relationship to the folder to clean up.
`removeWorkspace` on an `origin: 'initialized'` workspace deletes only the
two bookkeeping files it created (`spork.workspace.json`, the
`.code-workspace` file) and never the directory itself — that directory is
the user's own pre-existing folder, not something spork created, so there
is no "delete everything" option for it the way `workspace remove` offers
for a `create`-based workspace (`--keep-files` still means "touch nothing
at all," an orthogonal, outer check, unaffected by any of this).

### CLI behavior, decided with the user up front

- `init`'s target directory is always `cwd`, never a flag — it becomes the
  workspace root in place.
- A selected folder with no git remote still gets adopted, keyed by its
  own resolved local path (unchanged `adoptLocalRepo` behavior).
- Adopted repos' aliases always register locally to the new workspace — no
  `--global` flag for v1, mirroring `addRepo`'s own default.
- No TTY: default to every folder `findGitRepoDirs` found, mirroring `repo
  scan`'s "adopt everything" bulk philosophy — there's no useful *empty*
  `init`, unlike `create --repo`'s "nothing picked = empty workspace."
  Selecting (or finding) zero folders is a hard error either way.
- CLI-only — no MCP tool, same reasoning `open`/`exec` are CLI-only: no
  interactive terminal on the other end of an MCP call to drive a folder
  picker. An agent can still reach the same outcome by calling
  `create_workspace` + `add_repo` explicitly per folder (accepting the
  worktree/branch tradeoff that implies), or this can be revisited later
  with an explicit-folder-list tool if that turns out to matter.
