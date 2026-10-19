import { describe, expect, it } from 'vitest'
import { createMcpContext, workspaceContext } from '../src/context.js'

describe('createMcpContext', () => {
  it('builds a context from @spork/core\'s path constants', () => {
    const ctx = createMcpContext()

    expect(ctx.reposRoot).toContain('.spork')
    expect(ctx.registryPath).toContain('workspaces.json')
    expect(ctx.repoRegistryPath).toContain('repos.json')
  })
})

describe('workspaceContext', () => {
  it('narrows to just the fields @spork/core\'s workspace functions need', () => {
    const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

    expect(workspaceContext(ctx)).toEqual({ reposRoot: '/repos', repoRegistryPath: '/repos.json' })
  })
})
