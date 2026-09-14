---
name: new-package
description: Scaffold a new packages/<name> workspace package with this repo's standard boilerplate (package.json, tsconfig, README, CLAUDE.md, src/index.ts, test setup). Use when adding a new package to the yarn workspace.
---

# new-package

Scaffolds a new `packages/<name>` package matching the conventions already used by
`packages/core` and `packages/cli`, so new packages don't drift from the repo's
structure (project references, size limits, README/CLAUDE.md-per-module, test
coverage setup).

## Steps

1. Ask (or infer from context) the package name and a one-line description of its
   purpose.
2. Create `packages/<name>/`:
   - `package.json` — name it `@spork/<name>`, `"private": true`, a `test` script
     matching the other packages (`vitest run --coverage`), and dependencies as
     needed. Mirror `packages/core/package.json` for the exact shape.
   - `tsconfig.json` — extends `../../tsconfig.base.json`, sets `"composite": true`,
     an `outDir`/`rootDir` under `src`/`dist`, and a `references` entry for any
     in-repo package it depends on (e.g. `cli` depends on `core`).
   - `vitest.config.ts` — matching `packages/core/vitest.config.ts`'s coverage
     thresholds (80% lines/functions/branches/statements).
   - `src/index.ts` — the package's public export surface. Nothing outside this
     package should import from `src/*` directly.
   - `test/` — empty to start; every subsequent feature added to this package must
     land with tests here (see root [CONTRIBUTING.md](../../../CONTRIBUTING.md)).
   - `README.md` — purpose, structure, public exports. Use the
     [readme-sync](../readme-sync/SKILL.md) skill's format once there's real
     source to describe.
   - `CLAUDE.md` — short agent-facing context: what this package owns, what it
     must not reach into, any gotchas.
3. Add `{ "path": "packages/<name>" }` to the root `tsconfig.json`'s `references`.
4. If another package should depend on it, add both a `dependencies` entry in that
   package's `package.json` and a `references` entry in its `tsconfig.json`.
5. Run `yarn install` so the new workspace is linked, then `yarn build` to confirm
   the project references resolve.

## Non-goals

- Don't add example/demo code beyond a minimal `src/index.ts` — real modules get
  filled in by the feature work that follows.
