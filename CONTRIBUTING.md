# Contributing

## Scope and size

- Keep PRs to a single concern. If you notice something unrelated worth fixing,
  open a separate PR for it.
- Keep files small — ESLint enforces a 300-line-per-file and 50-line-per-function
  limit (see [eslint.config.js](eslint.config.js)). Treat hitting the limit as a
  signal to split the module along a real boundary, not to raise the limit.
- Prefer several small, sequential commits over one large one when a change
  naturally decomposes (e.g. "add manifest schema" then "wire manifest into
  workspace.create").

## Tests

- Every new or changed feature ships with unit tests in the same PR. We enforce
  ≥80% coverage (lines/functions/branches/statements) via vitest's coverage
  thresholds in CI — a PR that drops coverage below that will fail.
- Mock `child_process`/exec calls rather than spawning real `git` or `code`
  processes. Real-subprocess integration tests are intentionally out of scope for
  now (they're slower and more environment-dependent); that's a deferred, separate
  effort.

## Documentation

- If your change touches a module's source, update that module's `README.md` in
  the same PR — `tools/readme-sync/check.ts` enforces this in CI. Use the
  [readme-sync skill](.claude/skills/readme-sync/SKILL.md) to draft the update
  rather than writing it from scratch.
- Non-trivial architectural changes should have (or update) a design doc under
  [docs/plans](docs/plans) before or alongside the implementation.

## Before opening a PR

```sh
yarn build
yarn lint
yarn test
yarn readme-sync:check
```

The [PR template](.github/PULL_REQUEST_TEMPLATE.md) checklist mirrors this list.
