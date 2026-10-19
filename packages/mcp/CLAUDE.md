# @spork/mcp — agent context

An MCP server frontend for spork, parallel to `@spork/cli`: wires
`@spork/core`'s public surface up to MCP tools instead of `commander`
subcommands. No domain logic lives here.

- Import only from `@spork/core`'s `src/index.ts` — never reach into
  `@spork/core/src/*` directly, same rule `@spork/cli` follows.
- One MCP tool per core capability, each in its own module under
  `src/tools/`, registered via `tools/index.ts`'s `registerTools` —
  don't grow a single switch/handler file as tools accumulate.
- A tool handler resolves on success (`textResult`/`jsonResult`) and
  otherwise just lets whatever `@spork/core` throws (`SporkError` or
  anything else) propagate — don't wrap it in a try/catch. The SDK's own
  `McpServer` dispatch loop already catches any thrown error and turns
  it into a proper `{ isError: true }` tool result; catching it here too
  would just be redundant.
- This package has no interactive terminal on the other end of a call —
  there's no prompt to fall back to the way `@spork/cli` does
  (`@spork/prompts`' `select()`/`confirm()`), and no confirmation step
  for a destructive tool like `remove_workspace` either. Calling the
  tool at all **is** the caller's explicit confirmation, the same as a
  CLI script passing `--yes`. Don't invent a "confirm first" tool-call
  convention — that's an agent/client-side concern (the calling agent
  deciding whether to ask its own user first), not something this
  server can enforce.
- A parameter whose CLI equivalent defaults to the terminal's cwd
  (`--dir`, cwd-based workspace auto-detection, `repo list`'s
  local/global default) has no such fallback here — the MCP server
  process's own cwd isn't something the calling agent or user has any
  reason to know or expect. Require the parameter explicitly instead of
  defaulting to `process.cwd()` (`create_workspace`'s `dir`, `list_repos`'
  `workspace`).
- Shared orchestration that more than one frontend needs (e.g. "create a
  workspace and register it," "remove a workspace and unregister it")
  belongs in `@spork/core` (`createAndRegisterWorkspace`,
  `removeAndUnregisterWorkspace`), not duplicated here — `@spork/cli`'s
  `create.ts`/`remove.ts` call the exact same functions. If a new tool
  needs the same two-step pairing a CLI command already has, check
  whether core already has (or should gain) the combined function before
  re-implementing the pairing in this package.
- Mock `@spork/core` in tests, same as `@spork/cli` does — this package
  should never spawn a real `git` process or touch the filesystem in unit
  tests either. `test/fakeServer.ts`'s `createFakeServer()` is the shared
  fake `McpServer` every tool's test uses to capture its `registerTool`
  call and invoke the handler directly.
