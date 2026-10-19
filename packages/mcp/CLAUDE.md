# @spork/mcp — agent context

An MCP server frontend for spork, parallel to `@spork/cli`: wires
`@spork/core`'s public surface up to MCP tools instead of `commander`
subcommands. No domain logic lives here.

- Import only from `@spork/core`'s `src/index.ts` — never reach into
  `@spork/core/src/*` directly, same rule `@spork/cli` follows.
- One MCP tool per core capability, each in its own module under `src/tools/`
  once real tools land (mirroring `@spork/cli`'s one-file-per-subcommand
  split) — don't grow a single switch/handler file as tools accumulate.
- Tool input/output schemas should reuse `@spork/core`'s exported types
  rather than redeclaring shapes by hand, so a core type change surfaces as
  a type error here instead of silently drifting.
- Mock `@spork/core` in tests, same as `@spork/cli` does — this package
  should never spawn a real `git` process or touch the filesystem in unit
  tests either.
