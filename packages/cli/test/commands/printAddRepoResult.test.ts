import { describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({ SporkError: class SporkError extends Error {} }))

const { printAddRepoResult } = await import('../../src/commands/workspace/addRepo.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

const widgetsEntry = {
  folder: 'widgets',
  source: 'git@github.com:acme/widgets.git',
  requestedRef: 'HEAD',
  localBranch: 'demo',
  addedAt: '',
}

describe('printAddRepoResult', () => {
  it('is reused directly by callers other than the add-repo command (e.g. create --repo)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false })

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Added "widgets"')
    logSpy.mockRestore()
  })

  it('shows which registry the alias landed in', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'global', submodulesInitialized: false })

    expect(logSpy.mock.calls.flat().join('\n')).toContain('(alias: global)')
    logSpy.mockRestore()
  })
})

describe('printAddRepoResult — branch reuse', () => {
  it('notes when an existing branch was reused instead of creating a fresh one', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false, reusedExistingBranch: true })

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Reused existing branch "demo"')
    logSpy.mockRestore()
  })

  it('says nothing about reuse when a fresh branch was created', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false, reusedExistingBranch: false })

    expect(logSpy.mock.calls.flat().join('\n')).not.toContain('Reused')
    logSpy.mockRestore()
  })
})

describe('printAddRepoResult — remote branch', () => {
  it('notes when the worktree started from the remote branch', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false, reusedExistingBranch: true, remoteBranch: 'updated' })

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain(`Started "widgets" from the remote's "demo"`)
    expect(output).not.toContain('Reused')
    logSpy.mockRestore()
  })

  it('warns when the local branch had diverged and was kept', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false, reusedExistingBranch: true, remoteBranch: 'diverged' })

    expect(logSpy.mock.calls.flat().join('\n')).toContain('has diverged from the remote')
    logSpy.mockRestore()
  })
})
