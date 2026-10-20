import { coverageConfigDefaults, defineConfig } from 'vitest/config'

/**
 * Vitest's v8 coverage provider computes ONE merged report across every
 * project in `vitest.workspace.ts` — each project's own `vitest.config.ts`
 * `coverage.include`/`exclude` governs its own standalone run perfectly
 * (confirmed directly: `vitest run --coverage` from inside e.g.
 * `packages/mcp` alone reports only that package's files), but the
 * *combined* report built when running from the repo root does not
 * actually respect those per-project settings — it falls back to scanning
 * from the repo root with no effective exclude, which is how a real,
 * unrelated project checked out under `workspaces/` (a user's own spork
 * workspace, sitting inside this repo's own working directory but
 * git/eslint-ignored) ended up contributing thousands of irrelevant
 * zero-coverage entries to `yarn test`'s report. This root config is what
 * actually governs that merged report; each package's own config still
 * applies (and still enforces its own 80% threshold) when run standalone.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'tools/*/*.ts'],
      exclude: [...coverageConfigDefaults.exclude, '**/workspaces/**'],
    },
  },
})
