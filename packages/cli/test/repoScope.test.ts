import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeRepoScope, resolveRepoScope } from '../src/repoScope.js'

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json' }

let root: string
let workspaceDir: string
let outsideDir: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-repo-scope-'))
  workspaceDir = path.join(root, 'demo')
  await mkdir(workspaceDir, { recursive: true })
  await writeFile(path.join(workspaceDir, 'spork.workspace.json'), '{}', 'utf8')
  outsideDir = path.join(root, 'not-a-workspace')
  await mkdir(outsideDir, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('resolveRepoScope', () => {
  it('defaults to local when cwd is inside a workspace', () => {
    const scope = resolveRepoScope(ctx, {}, workspaceDir)

    expect(scope).toEqual({ scope: 'local', registryPath: path.join(workspaceDir, 'spork.repos.json'), workspaceDir })
  })

  it('defaults to global when cwd is not inside a workspace', () => {
    const scope = resolveRepoScope(ctx, {}, outsideDir)

    expect(scope).toEqual({ scope: 'global', registryPath: '/repos.json' })
  })

  it('--global always wins regardless of cwd', () => {
    const scope = resolveRepoScope(ctx, { global: true }, workspaceDir)

    expect(scope).toEqual({ scope: 'global', registryPath: '/repos.json' })
  })

  it('--local uses the enclosing workspace', () => {
    const scope = resolveRepoScope(ctx, { local: true }, workspaceDir)

    expect(scope.scope).toBe('local')
    expect(scope.workspaceDir).toBe(workspaceDir)
  })

  it('--local outside any workspace is a SporkError', () => {
    expect(() => resolveRepoScope(ctx, { local: true }, outsideDir)).toThrow(
      /not inside a workspace/i,
    )
  })

  it('passing both --global and --local is a SporkError', () => {
    expect(() => resolveRepoScope(ctx, { global: true, local: true }, workspaceDir)).toThrow(/either/i)
  })
})

describe('describeRepoScope', () => {
  it('names the workspace for a local scope', () => {
    expect(describeRepoScope({ scope: 'local', registryPath: 'x', workspaceDir })).toBe('local to "demo"')
  })

  it('says "global" for a global scope', () => {
    expect(describeRepoScope({ scope: 'global', registryPath: 'x' })).toBe('global')
  })
})
