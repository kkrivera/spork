# @spork/mcp

An MCP (Model Context Protocol) server exposing spork's workspace/repo
operations as tools, so Claude or another agent can drive spork directly
instead of shelling out to the `spork` CLI.

## Structure

- `src/index.ts` — `createServer()` builds the `McpServer` instance (name
  `"spork"`) and registers every tool against it (`registerTools`);
  `main()` connects it over stdio. Guarded so importing this module (as
  tests do) doesn't itself start the server.
- `src/sea-entry.ts` — the entry point `tools/package-binary` bundles into
  the packaged `spork-mcp` binary instead of `index.ts`: a Single Executable
  Application has no separate "script path", so `index.ts`'s import-meta
  guard above always evaluates to false there. This file just calls `main`
  unconditionally.
- `src/context.ts` — `createMcpContext()` builds the `{ reposRoot,
  registryPath, repoRegistryPath }` every tool needs from `@spork/core`'s
  path constants (no `ui`/color concerns, unlike `@spork/cli`'s context —
  a tool's result is structured text, not terminal output); `workspaceContext`
  narrows it to what `@spork/core`'s workspace functions need, mirroring
  `@spork/cli`'s own narrowing helper.
- `src/textResult.ts` — `textResult`/`jsonResult`: the two result shapes
  every tool here returns on success (a plain sentence, or a
  pretty-printed JSON value for a list/object result). A tool that
  throws is **not** caught here — the SDK's own dispatch loop catches
  any error a tool handler throws and turns it into a proper
  `{ isError: true }` result automatically, so a tool just needs to
  resolve on success or let `@spork/core`'s own `SporkError` (or
  anything else) propagate on failure.
- `src/tools/` — one module per tool (`registerTools` in `index.ts` wires
  them all onto the server), mirroring `@spork/cli`'s one-file-per-
  subcommand split:
  - `list_workspaces` — every registered workspace (name + directory).
  - `create_workspace` — `{ name, dir }`, `dir` an absolute *parent*
    directory (no cwd fallback — the MCP server process's own cwd isn't
    meaningful to the caller, unlike `@spork/cli`'s `--dir`). Uses
    `@spork/core`'s `createAndRegisterWorkspace`.
  - `add_repo` — `{ workspace, source, ref?, folder?, global? }`.
  - `remove_repo` — `{ workspace, folder }`.
  - `remove_workspace` — `{ workspace, keepFiles? }`. No confirmation
    prompt (there's no interactive terminal on the other end of a tool
    call) — calling the tool at all is the caller's explicit
    confirmation, the same way a CLI script passes `--yes`. Uses
    `@spork/core`'s `removeAndUnregisterWorkspace`.
  - `workspace_status` — `{ workspace }`, the same per-worktree status
    `spork workspace status` prints, as JSON.
  - `list_repos` — `{ workspace? }`: every global repo alias, plus a
    given workspace's own local aliases. `workspace` is explicit rather
    than cwd-detected, unlike `spork repo list`'s local-if-cwd-is-inside-
    a-workspace default — same reasoning as `create_workspace`'s `dir`.

  Deliberately not exposed: `open` (launches VS Code locally — meaningless
  for an agent) and `exec` (a long-running/interactive foreground
  process is a poor fit for a synchronous request/response tool call;
  see `@spork/cli`'s `commandExecutor.ts` for why that one needs the
  real terminal directly).

## Registering this server

Build it (`yarn build` from the repo root, or just this package), then
point an MCP client at the built entry point — for Claude Code:

```sh
claude mcp add spork -- node /path/to/spork/packages/mcp/dist/index.js
```

## Testing

`yarn test` (vitest, ≥80% coverage enforced). `test/fakeServer.ts`'s
`createFakeServer()` is a minimal fake `McpServer` that just records every
`registerTool` call, so a tool's test can invoke its handler directly
without a real MCP connection — mirroring `@spork/cli`'s own small
per-concern test fakes (`opener.test.ts`'s `fakeOpener`, etc.). Tests mock
`@spork/core` the same way `@spork/cli`'s do — this package never touches
the filesystem or spawns a subprocess in unit tests either.
