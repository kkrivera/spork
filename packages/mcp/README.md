# @spork/mcp

An MCP (Model Context Protocol) server exposing spork's workspace/repo
operations as tools, so Claude or another agent can drive spork directly
instead of shelling out to the `spork` CLI.

## Structure

- `src/index.ts` — `createServer()` builds the `McpServer` instance (name/
  version, no tools registered yet); `main()` connects it over stdio.
  Guarded so importing this module (as tests do) doesn't itself start the
  server. No tools are registered yet — each spork capability gets wired up
  as a dedicated MCP tool as follow-up feature work, importing only from
  `@spork/core`'s public `src/index.ts` surface (same rule `@spork/cli`
  follows).

## Testing

`yarn test` (vitest, ≥80% coverage enforced).
