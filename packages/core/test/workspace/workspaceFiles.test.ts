import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/repo/cache.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/repo/cache.js')>('../../src/repo/cache.js')
  return { ...actual, ensureRepoCache: vi.fn() }
})
vi.mock('../../src/repo/lock.js', () => ({
  withRepoLock: vi.fn((_target: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('../../src/git/worktree.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/git/worktree.js')>('../../src/git/worktree.js')
  return { ...actual, addWorktree: vi.fn(), removeWorktree: vi.fn(), pruneWorktrees: vi.fn() }
})

const { addWorktree, removeWorktree } = await import('../../src/git/worktree.js')
const { ensureRepoCache } = await import('../../src/repo/cache.js')
const { createWorkspace, initWorkspace, addRepo, removeRepo, removeWorkspace } = await import('../../src/workspace/workspace.js')
const { inspectRepoAgentFiles } = await import('../../src/workspace/workspaceFiles.js')
const { fakeAddWorktree } = await import('./fakeAddWorktree.js')

let root: string
let dir: string
const ctx = { reposRoot: '', repoRegistryPath: '' }

const read = (file: string, base = dir): Promise<string> => readFile(path.join(base, file), 'utf8')

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-workspace-files-'))
  dir = path.join(root, 'demo')
  ctx.reposRoot = path.join(root, 'repos')
  ctx.repoRegistryPath = path.join(root, 'repos.json')
  vi.mocked(addWorktree).mockReset().mockImplementation(fakeAddWorktree)
  vi.mocked(removeWorktree).mockReset().mockResolvedValue(undefined)
  vi.mocked(ensureRepoCache).mockReset().mockResolvedValue({ id: 'x', source: '', path: '/unused' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('workspace AGENTS.md / CLAUDE.md lifecycle', () => {
  it('writes both files on create, with CLAUDE.md importing AGENTS.md', async () => {
    await createWorkspace(ctx, { name: 'demo', dir })

    expect(await read('AGENTS.md')).toContain('It has no repos yet.')
    expect(await read('CLAUDE.md')).toContain('@AGENTS.md')
  })

  it('updates the repo list on every add-repo and remove-repo', async () => {
    await createWorkspace(ctx, { name: 'demo', dir })

    await addRepo(ctx, dir, { source: 'git@github.com:acme/widgets.git' })
    await addRepo(ctx, dir, { source: 'git@github.com:acme/gadgets.git' })
    expect(await read('AGENTS.md')).toContain('| `widgets/` |')
    expect(await read('AGENTS.md')).toContain('| `gadgets/` |')

    await removeRepo(ctx, dir, 'widgets')
    const agents = await read('AGENTS.md')
    expect(agents).not.toContain('widgets')
    expect(agents).toContain('| `gadgets/` |')
    expect(agents).toContain('1 independent git repository,')
  })

  it("reflects a repo's own instruction and config files at the next regeneration", async () => {
    await createWorkspace(ctx, { name: 'demo', dir })
    await addRepo(ctx, dir, { source: 'git@github.com:acme/widgets.git' })
    await writeFile(path.join(dir, 'widgets', 'AGENTS.md'), '# widgets rules\n')
    await mkdir(path.join(dir, 'widgets', '.claude', 'agents'), { recursive: true })

    await addRepo(ctx, dir, { source: 'git@github.com:acme/gadgets.git' })

    const claude = await read('CLAUDE.md')
    expect(claude).toContain('@widgets/AGENTS.md')
    expect(claude).toContain('- `widgets/`: `.claude/agents/`')
  })

  it('never writes either file for a workspace that opted out', async () => {
    await createWorkspace(ctx, { name: 'demo', dir, agentInstructions: false })
    await addRepo(ctx, dir, { source: 'git@github.com:acme/widgets.git' })

    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(false)
    expect(existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false)
  })
})

describe('workspace AGENTS.md / CLAUDE.md in an initialized folder', () => {
  it("keeps the user's own CLAUDE.md content, and restores it exactly on remove", async () => {
    await mkdir(dir, { recursive: true })
    const mine = '# My project\n\nAlways run make check.\n'
    await writeFile(path.join(dir, 'CLAUDE.md'), mine)

    await initWorkspace(ctx, { name: 'demo', dir })
    const claude = await read('CLAUDE.md')
    expect(claude.startsWith(mine.trimEnd())).toBe(true)
    expect(claude).toContain('@AGENTS.md')

    await removeWorkspace(ctx, dir)
    expect(await read('CLAUDE.md')).toBe(mine)
    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(false)
    expect(existsSync(dir)).toBe(true)
  })
})

describe('inspectRepoAgentFiles', () => {
  it('reports which instruction and config files a repo folder has', async () => {
    const repo = path.join(root, 'repo')
    await mkdir(path.join(repo, '.claude'), { recursive: true })
    await writeFile(path.join(repo, 'CLAUDE.md'), '')
    await writeFile(path.join(repo, '.claude', 'settings.json'), '{}')

    expect(inspectRepoAgentFiles(repo)).toEqual({ claudeMd: true, agentsMd: false, claudeSettings: true, claudeAgents: false })
  })
})
