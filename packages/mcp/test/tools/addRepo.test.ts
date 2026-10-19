import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createFakeServer } from '../fakeServer.js'

vi.mock('@spork/core', () => ({
  addRepo: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
}))

const { addRepo, resolveWorkspaceDir } = await import('@spork/core')
const { registerAddRepoTool } = await import('../../src/tools/addRepo.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

const widgetsEntry = {
  folder: 'widgets',
  source: 'git@github.com:acme/widgets.git',
  requestedRef: 'HEAD',
  localBranch: 'demo',
  addedAt: '',
}

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(addRepo)
    .mockReset()
    .mockResolvedValue({ entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false })
})

describe('registerAddRepoTool', () => {
  it('registers "add_repo" with workspace/source required and the rest optional', () => {
    const { server, tools } = createFakeServer()

    registerAddRepoTool(server as unknown as McpServer, ctx)

    expect(tools[0]?.name).toBe('add_repo')
    expect(tools[0]?.config.inputSchema).toHaveProperty('workspace')
    expect(tools[0]?.config.inputSchema).toHaveProperty('source')
  })

  it('resolves the workspace and adds the repo, reporting the alias scope', async () => {
    const { server, tools } = createFakeServer()
    registerAddRepoTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({ workspace: 'demo', source: 'git@github.com:acme/widgets.git' })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(addRepo).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      '/ws/demo',
      { source: 'git@github.com:acme/widgets.git', ref: undefined, folder: undefined, global: undefined },
    )
    expect(result?.content[0]?.text).toContain('Added "widgets"')
    expect(result?.content[0]?.text).toContain('(alias: local)')
  })

  it('notes a reused branch and submodule results in the summary', async () => {
    vi.mocked(addRepo).mockResolvedValue({
      entry: widgetsEntry,
      aliasScope: 'local',
      submodulesInitialized: true,
      reusedExistingBranch: true,
    })
    const { server, tools } = createFakeServer()
    registerAddRepoTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({ workspace: 'demo', source: 'git@github.com:acme/widgets.git' })

    const text = result?.content[0]?.text ?? ''
    expect(text).toContain('Reused the existing branch')
    expect(text).toContain('Initialized submodules')
  })

  it('surfaces a submodule warning without failing the whole call', async () => {
    vi.mocked(addRepo).mockResolvedValue({
      entry: widgetsEntry,
      aliasScope: 'local',
      submodulesInitialized: false,
      submoduleWarning: 'could not read Username',
    })
    const { server, tools } = createFakeServer()
    registerAddRepoTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({ workspace: 'demo', source: 'git@github.com:acme/widgets.git' })

    expect(result?.content[0]?.text).toContain('could not read Username')
  })
})
