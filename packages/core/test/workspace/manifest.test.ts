import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createManifest, manifestPath, readManifest, writeManifest } from '../../src/workspace/manifest.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spork-manifest-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('createManifest', () => {
  it('starts with no worktrees and a createdAt timestamp', () => {
    const manifest = createManifest('demo')

    expect(manifest.name).toBe('demo')
    expect(manifest.worktrees).toEqual([])
    expect(new Date(manifest.createdAt).toString()).not.toBe('Invalid Date')
  })
})

describe('manifestPath', () => {
  it('points at spork.workspace.json inside the workspace dir', () => {
    expect(manifestPath('/ws/demo')).toBe(path.join('/ws/demo', 'spork.workspace.json'))
  })
})

describe('writeManifest / readManifest', () => {
  it('round-trips a manifest to disk', async () => {
    const manifest = createManifest('demo')
    manifest.worktrees.push({
      folder: 'widgets',
      source: 'git@github.com:acme/widgets.git',
      requestedRef: 'main',
      localBranch: 'spork/demo/widgets',
      addedAt: new Date().toISOString(),
    })

    await writeManifest(dir, manifest)
    const loaded = await readManifest(dir)

    expect(loaded).toEqual(manifest)
  })

  it('writes pretty-printed, newline-terminated JSON', async () => {
    await writeManifest(dir, createManifest('demo'))

    const raw = await readFile(manifestPath(dir), 'utf8')

    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('\n  "name": "demo"')
  })
})
