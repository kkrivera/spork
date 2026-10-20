# tools/release

Bumps spork's version in lockstep, in one shot. Run as a GitHub Action
(`release-bump.yml`), never by hand against `main` — see
[docs/RELEASING.md](../../docs/RELEASING.md).

## How it works

`bump-version.ts --bump <patch|minor|major>` reads the current version from
the root `package.json`, computes the next one (`nextVersion`), and then:

- writes it into the root `package.json` and every `packages/*/package.json`,
- patches the two hardcoded version-string literals that can't be read from
  `package.json` at runtime inside a packaged SEA binary: `@spork/cli`'s
  `.version(...)` call in `packages/cli/src/index.ts`, and `@spork/mcp`'s
  `McpServer({ version })` in `packages/mcp/src/index.ts`.

It prints the new version to stdout as its last line, which
`release-bump.yml` captures to name the commit and tag it creates. No
changelog file is generated — GitHub's `gh release create --generate-notes`
builds release notes from commit history instead.

## Usage

```sh
yarn release:bump --bump patch   # 0.1.0 -> 0.1.1
yarn release:bump --bump minor   # 0.1.0 -> 0.2.0
yarn release:bump --bump major   # 0.1.0 -> 1.0.0
```
