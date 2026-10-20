import { coverageConfigDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    watch: {
      ignored: ['**/workspaces/**'],
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['*.ts'],
      exclude: [...coverageConfigDefaults.exclude, '**/workspaces/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
