import { describe, expect, it } from 'vitest'
import { createAppContext, removeRepoSourceContext, repoContext, workspaceContext } from '../src/context.js'

describe('createAppContext', () => {
  it('roots reposRoot/registryPath/repoRegistryPath under ~/.spork and builds a Ui', () => {
    const ctx = createAppContext({ argv: ['--no-color'] })

    expect(ctx.reposRoot).toContain('.spork')
    expect(ctx.registryPath).toContain('.spork')
    expect(ctx.repoRegistryPath).toContain('.spork')
    expect(ctx.ui.isColorEnabled).toBe(false)
  })
})

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json' }

describe('workspaceContext', () => {
  it('narrows to reposRoot + repoRegistryPath', () => {
    expect(workspaceContext(ctx)).toEqual({ reposRoot: '/repos', repoRegistryPath: '/repos.json' })
  })
})

describe('repoContext', () => {
  it('narrows to reposRoot + repoRegistryPath', () => {
    expect(repoContext(ctx)).toEqual({ reposRoot: '/repos', repoRegistryPath: '/repos.json' })
  })
})

describe('removeRepoSourceContext', () => {
  it('adds the workspace registry path for the in-use check', () => {
    expect(removeRepoSourceContext(ctx)).toEqual({
      reposRoot: '/repos',
      repoRegistryPath: '/repos.json',
      workspaceRegistryPath: '/workspaces.json',
    })
  })
})
