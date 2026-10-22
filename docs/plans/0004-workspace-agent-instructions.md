# 0004 — Agent instructions at the workspace root

Status: Accepted

## Problem

A spork workspace is a folder of independent git repos, and each repo
usually carries its own agent instructions (`CLAUDE.md`, `AGENTS.md`,
`.claude/`). When someone starts Claude Code (or another coding agent) at
the workspace root, nothing tells it that:

- the root is not a repo, and every subfolder is its own repo with its own
  history, so git, builds, and tests have to run inside the right folder;
- each repo's own instructions apply to work inside it;
- some of a repo's setup does not apply at all from the root.

That last point comes from how Claude Code loads project config from a
parent directory (checked against the Claude Code docs, October 2026):

| A repo's... | Applied from the workspace root? |
| --- | --- |
| `CLAUDE.md` | Yes, lazily, once Claude reads or edits a file in that repo |
| `.claude/skills/` | Yes, the same way |
| `AGENTS.md` | Only if the repo has no `CLAUDE.md`, and only on a Read-tool read |
| `.claude/settings.json` (hooks, permissions, env) | No, only the launch directory's |
| `.claude/agents/` | No |

Subagents can't close the gap: they always run in the main session's
directory with its settings. Only a separate session started inside the
repo (`cd api && claude`, or `claude -p` there) gets that repo's full
config.

## Design

### Two generated files, one source of truth

spork writes two files at the workspace root:

- **`AGENTS.md`**: the real content, tool-neutral so any agent that reads
  `AGENTS.md` benefits. It lists each repo (folder, source, branch) and the
  ground rules: each folder is its own repo, read and follow a repo's own
  instructions before changing it, run git/builds/tests from inside the
  repo's folder, commit per repo, stay on the workspace branch, and use
  `spork` commands rather than hand-editing spork's own files.
- **`CLAUDE.md`**: a short Claude-specific file that imports `@AGENTS.md`
  (Claude Code reads a root `AGENTS.md` natively only when no `CLAUDE.md`
  exists, and a workspace created by `init` may already have one). It also
  imports `@<folder>/AGENTS.md` for any repo that has an `AGENTS.md` but no
  `CLAUDE.md`, since Claude Code wouldn't otherwise load it reliably, and
  names every repo whose `.claude/settings.json` or `.claude/agents/` won't
  apply from the root, telling Claude to run that repo's checks from inside
  it and to suggest a session started there for larger changes.

Repos' own `CLAUDE.md` files are deliberately *not* imported. Claude Code
already loads them lazily when it works in that repo, and importing every
repo's instructions up front would spend context on repos the task never
touches.

### Regenerated on every manifest change

Both files are rendered from the manifest plus a look at each repo folder
on disk (which instruction and config files it has). They are regenerated
everywhere the `.code-workspace` file already is: `workspace create`,
`workspace init`, `add-repo`, an `init` adoption, `remove-repo`, and the
reconcile step that drops folders deleted by hand. Rather than adding a
second call at each of those six sites, they all call one
`writeWorkspaceFiles(dir, manifest)` that writes the `.code-workspace` file
and both agent files together, so a future manifest-changing path can't
update one and forget the others.

A repo that gains or loses instruction files after it was added (say, a
`git pull` brings in a `CLAUDE.md`) is picked up the next time the
workspace's repo list changes, not immediately. That's acceptable: the
ground rules and repo list are what matter most, and they're always
current.

### Only spork's own block is ever touched

spork's content sits between `<!-- spork:begin -->` and
`<!-- spork:end -->` markers. On each write:

- no file yet: write just the block;
- a file with the markers: replace what's between them, keep everything
  else as the user left it;
- a file without the markers (a user's own `CLAUDE.md` in an `init`ed
  folder): append the block, leaving the existing content untouched.

On `workspace remove`, a `created` workspace's directory is deleted
outright as before. An `initialized` workspace only has spork's block
stripped from each file, and the file is deleted only if nothing else is
left in it, matching `init`'s rule that removal never deletes anything the
user owns.

### Opting out

A manifest-level `agentInstructions: false` turns the whole thing off for
one workspace (absent means on). `workspace create` and `workspace init`
take `--no-agent-files` to set it. Every regeneration checks it first, so
an opted-out workspace never gets these files written.

## Not done here

- **Delegating work to a per-repo session** (headless `claude -p` started
  inside a repo so its hooks and permissions apply). The generated
  `CLAUDE.md` points at the gap. Automating it is a separate change.
- **Turning the files on or off for an existing workspace.** Only create
  and init set the flag for now.
- **The MCP server's `create_workspace`** doesn't take the opt-out yet. It
  gets the default (on).
