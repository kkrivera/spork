import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  scanAndAddRepos: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  localRepoRegistryPath: (workspaceDir: string) => `${workspaceDir}/spork.repos.json`,
  SporkError: class SporkError extends Error {},
}))

const { scanAndAddRepos, findEnclosingWorkspaceDir } = await import('@spork/core')
const { runScan, registerScanCommand } = await import('../../src/commands/repo/scan.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }
const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

beforeEach(() => {
  vi.mocked(scanAndAddRepos)
    .mockReset()
    .mockResolvedValue({ added: [{ alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' }], skipped: [] })
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
})

describe('runScan', () => {
  it('scans globally (outside any workspace) by default', async () => {
    const result = await runScan(ctx, '/home/user/code', {})

    expect(scanAndAddRepos).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/home/user/code')
    expect(result.scopeLabel).toBe('global')
    expect(result.result.added).toHaveLength(1)
  })

  it('scans locally by default when inside a workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')

    const result = await runScan(ctx, '/home/user/code', {})

    expect(scanAndAddRepos).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/ws/demo/spork.repos.json' },
      '/home/user/code',
    )
    expect(result.scopeLabel).toBe('local to "demo"')
  })

  it('--global overrides being inside a workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')

    const result = await runScan(ctx, '/home/user/code', { global: true })

    expect(scanAndAddRepos).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/home/user/code')
    expect(result.scopeLabel).toBe('global')
  })
})

describe('registerScanCommand', () => {
  it('prints added and skipped repos plus a summary line', async () => {
    vi.mocked(scanAndAddRepos).mockResolvedValue({
      added: [{ alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' }],
      skipped: [{ path: '/home/user/code/broken', reason: 'clone failed' }],
    })
    const program = new Command()
    registerScanCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'scan', '/home/user/code'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain(`"widgets" -> ${WIDGETS_SOURCE} (global)`)
    expect(output).toContain('Skipped /home/user/code/broken: clone failed')
    expect(output).toContain('1 added, 1 skipped.')
    logSpy.mockRestore()
  })
})
