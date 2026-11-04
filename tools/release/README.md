# tools/release

Bumps spork's version in lockstep and adds the release's `CHANGELOG.md`
section, in one shot. Run as a GitHub Action (`release-bump.yml`), never by
hand against `main` — see [docs/RELEASING.md](../../docs/RELEASING.md).

## How it works

`bump-version.ts --bump <patch|minor|major>` reads the current version from
the root `package.json`, computes the next one (`nextVersion`), and then:

- writes it into the root `package.json` and every `packages/*/package.json`,
- patches the two hardcoded version-string literals that can't be read from
  `package.json` at runtime inside a packaged SEA binary: `@spork/cli`'s
  `.version(...)` call in `packages/cli/src/index.ts`, and `@spork/mcp`'s
  `McpServer({ version })` in `packages/mcp/src/index.ts`.

It prints the new version to stdout as its last line, which
`release-bump.yml` captures to name the commit and tag it creates.

`changelog.ts --version <X.Y.Z>` then adds that version's section to the
top of the root `CHANGELOG.md` (creating the file if needed), plus its
link definition at the bottom. The section lists the titles of every
commit since the previous `vX.Y.Z` tag (`previousTag`, `commitTitles`),
minus merges and the release bot's own `chore(release)`/`chore(homebrew)`
commits, sorted into groups (`groupOf`):

| Group | Commit titles |
| --- | --- |
| Added | `feat:`, or starting with add, introduce, support, offer, generate, allow, let or scaffold |
| Fixed | `fix:`, or starting with fix |
| Removed | starting with remove, drop or delete |
| Documentation | `docs:` |
| Maintenance | `chore:`, `test:`, `ci:`, `build:`, `eslint:`, `vitest:`, `gitignore:`, `release:` |
| Changed | everything else |

The verb is read after any `scope:` prefix, so `cli: add a flag` is
Added. Earlier sections are never touched, and a version that already
has a section is refused. Its output is the new section, for the
workflow log.

## Usage

```sh
yarn release:bump --bump patch   # 0.1.0 -> 0.1.1
yarn release:bump --bump minor   # 0.1.0 -> 0.2.0
yarn release:bump --bump major   # 0.1.0 -> 1.0.0
yarn release:changelog --version 1.3.0
```
