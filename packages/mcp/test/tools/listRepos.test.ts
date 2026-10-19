import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createFakeServer } from '../fakeServer.js'

vi.mock('@spork/core', () => ({
  listRepoAliases: vi.fn(),
  localRepoRegistryPath: (dir: string) => `${dir}/spork.repos.json`,
  resolveWorkspaceDir: vi.fn(),
}))

const { listRepoAliases, resolveWorkspaceDir } = await import('@spork/core')
const { registerListReposTool } = await import('../../src/tools/listRepos.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(listRepoAliases).mockReset().mockResolvedValue([])
})

describe('registerListReposTool', () => {
  it('registers "list_repos" with workspace optional', () => {
    const { server, tools } = createFakeServer()

    registerListReposTool(server as unknown as McpServer, ctx)

    expect(tools[0]?.name).toBe('list_repos')
    expect(tools[0]?.config.inputSchema).toHaveProperty('workspace')
  })

  it('returns only global aliases when no workspace is given', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'git@github.com:acme/widgets.git', addedAt: '' }])
    const { server, tools } = createFakeServer()
    registerListReposTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({})

    expect(resolveWorkspaceDir).not.toHaveBeenCalled()
    expect(listRepoAliases).toHaveBeenCalledWith('/repos.json', '/repos')
    const entries = JSON.parse(result?.content[0]?.text ?? '')
    expect(entries).toEqual([{ alias: 'widgets', source: 'git@github.com:acme/widgets.git', addedAt: '', scope: 'global' }])
  })

  it('merges a workspace\'s local aliases with the global ones when workspace is given', async () => {
    vi.mocked(listRepoAliases)
      .mockResolvedValueOnce([{ alias: 'gadgets', source: 'git@github.com:acme/gadgets.git', addedAt: '' }])
      .mockResolvedValueOnce([{ alias: 'widgets', source: 'git@github.com:acme/widgets.git', addedAt: '' }])
    const { server, tools } = createFakeServer()
    registerListReposTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({ workspace: 'demo' })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(listRepoAliases).toHaveBeenCalledWith('/ws/demo/spork.repos.json', '/repos')
    const entries = JSON.parse(result?.content[0]?.text ?? '')
    expect(entries).toEqual([
      { alias: 'gadgets', source: 'git@github.com:acme/gadgets.git', addedAt: '', scope: 'local' },
      { alias: 'widgets', source: 'git@github.com:acme/widgets.git', addedAt: '', scope: 'global' },
    ])
  })
})
