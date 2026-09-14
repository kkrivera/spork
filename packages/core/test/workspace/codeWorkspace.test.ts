import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createManifest } from '../../src/workspace/manifest.js'
import { buildCodeWorkspace, codeWorkspaceFilePath, writeCodeWorkspace } from '../../src/workspace/codeWorkspace.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spork-codeworkspace-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('buildCodeWorkspace', () => {
  it('maps each worktree folder to a relative folder entry', () => {
    const manifest = createManifest('demo')
    manifest.worktrees.push(
      { folder: 'widgets', source: 'a', requestedRef: 'main', localBranch: 'b', addedAt: 'x' },
      { folder: 'gadgets', source: 'a', requestedRef: 'main', localBranch: 'b', addedAt: 'x' },
    )

    expect(buildCodeWorkspace(manifest)).toEqual({
      folders: [{ path: './widgets' }, { path: './gadgets' }],
    })
  })

  it('produces an empty folders list for an empty workspace', () => {
    expect(buildCodeWorkspace(createManifest('demo'))).toEqual({ folders: [] })
  })
})

describe('codeWorkspaceFilePath', () => {
  it('names the file after the workspace', () => {
    expect(codeWorkspaceFilePath('/ws/demo', 'demo')).toBe(path.join('/ws/demo', 'demo.code-workspace'))
  })
})

describe('writeCodeWorkspace', () => {
  it('writes a valid .code-workspace file and returns its path', async () => {
    const manifest = createManifest('demo')
    manifest.worktrees.push({ folder: 'widgets', source: 'a', requestedRef: 'main', localBranch: 'b', addedAt: 'x' })

    const filePath = await writeCodeWorkspace(dir, manifest)

    expect(filePath).toBe(codeWorkspaceFilePath(dir, 'demo'))
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    expect(parsed).toEqual({ folders: [{ path: './widgets' }] })
  })
})
