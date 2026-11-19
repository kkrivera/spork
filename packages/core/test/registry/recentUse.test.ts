import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listWorkspacesByRecentUse } from '../../src/registry/recentUse.js'
import { markWorkspaceUsed, registerWorkspace } from '../../src/registry/registry.js'
import { manifestPath } from '../../src/workspace/manifest.js'

let root: string
let registryPath: string

async function addWorkspace(name: string, createdAt: string | null): Promise<string> {
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  const manifest = createdAt === null ? '{not json' : JSON.stringify({ name, createdAt, worktrees: [] })
  await writeFile(manifestPath(dir), manifest, 'utf8')
  await registerWorkspace(registryPath, { name, dir })
  return dir
}

async function names(): Promise<string[]> {
  return (await listWorkspacesByRecentUse(registryPath)).map((workspace) => workspace.name)
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-recent-'))
  registryPath = path.join(root, 'workspaces.json')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('markWorkspaceUsed', () => {
  it('stamps the workspace found by name or by directory, leaving the rest alone', async () => {
    const dir = await addWorkspace('a', '2026-01-01T00:00:00.000Z')
    await addWorkspace('b', '2026-01-02T00:00:00.000Z')

    await markWorkspaceUsed(registryPath, 'a', new Date('2026-03-01T00:00:00.000Z'))
    await markWorkspaceUsed(registryPath, dir, new Date('2026-03-02T00:00:00.000Z'))

    const file = JSON.parse(await readFile(registryPath, 'utf8')) as { workspaces: { name: string; lastUsedAt?: string }[] }
    expect(file.workspaces).toEqual([
      expect.objectContaining({ name: 'a', lastUsedAt: '2026-03-02T00:00:00.000Z' }),
      expect.not.objectContaining({ lastUsedAt: expect.anything() }),
    ])
  })

  it('does nothing for an unregistered workspace, or when there is no registry yet', async () => {
    await markWorkspaceUsed(registryPath, 'ghost')
    await addWorkspace('a', '2026-01-01T00:00:00.000Z')
    const before = await readFile(registryPath, 'utf8')

    await markWorkspaceUsed(registryPath, '/somewhere/else')

    expect(await readFile(registryPath, 'utf8')).toBe(before)
  })
})

describe('listWorkspacesByRecentUse', () => {
  it('puts the most recently used first, falling back to when each was created', async () => {
    await addWorkspace('old-but-used', '2026-01-01T00:00:00.000Z')
    await addWorkspace('newest', '2026-02-01T00:00:00.000Z')
    await addWorkspace('middle', '2026-01-15T00:00:00.000Z')
    await markWorkspaceUsed(registryPath, 'old-but-used', new Date('2026-03-01T00:00:00.000Z'))

    expect(await names()).toEqual(['old-but-used', 'newest', 'middle'])
  })

  it('sorts a workspace with an unreadable manifest last, keeping registry order for ties', async () => {
    await addWorkspace('broken', null)
    await addWorkspace('x', '2026-01-01T00:00:00.000Z')
    await addWorkspace('y', '2026-01-01T00:00:00.000Z')

    expect(await names()).toEqual(['x', 'y', 'broken'])
  })
})
