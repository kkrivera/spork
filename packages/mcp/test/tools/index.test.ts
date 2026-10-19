import { describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createFakeServer } from '../fakeServer.js'

vi.mock('@spork/core', () => ({
  listWorkspaces: vi.fn(),
  createAndRegisterWorkspace: vi.fn(),
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
  removeAndUnregisterWorkspace: vi.fn(),
  getWorkspaceStatus: vi.fn(),
  listRepoAliases: vi.fn(),
  localRepoRegistryPath: (dir: string) => `${dir}/spork.repos.json`,
  resolveWorkspaceDir: vi.fn(),
}))

const { registerTools } = await import('../../src/tools/index.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

describe('registerTools', () => {
  it('registers every tool exactly once', () => {
    const { server, tools } = createFakeServer()

    registerTools(server as unknown as McpServer, ctx)

    expect(tools.map((tool) => tool.name).sort()).toEqual(
      ['add_repo', 'create_workspace', 'list_repos', 'list_workspaces', 'remove_repo', 'remove_workspace', 'workspace_status'].sort(),
    )
  })
})
