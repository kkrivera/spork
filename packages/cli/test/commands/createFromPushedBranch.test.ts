import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  addRepo: vi.fn(),
  prepareRemoteAccess: vi.fn(),
  branchConflictError: vi.fn(() => null),
  defaultAlias: (source: string) => source.replace('-src', ''),
  repoOwner: (source: string) => (source === 'app-src' ? 'acme' : null),
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))
vi.mock('@spork/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { addRepo, prepareRemoteAccess, SporkError } = await import('@spork/core')
const { runTasks } = await import('@spork/task-runner')
const { confirm, select } = await import('@spork/prompts')
const { createFromPushedBranch, listInWords } = await import('../../src/commands/workspace/createFromPushedBranch.js')
const { createUi } = await import('../../src/output/color.js')
const { fakeRemoteAccess } = await import('./fakeRemoteAccess.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }
const handle = { name: 'demo', dir: '/ws/demo', manifest: { name: 'demo', createdAt: '', worktrees: [] } }
const candidates = ['app', 'infra', 'docs'].map((alias) => ({ alias, source: `${alias}-src`, scope: 'global' as const, addedAt: '' }))

async function fakeRunTasks(tasks: readonly FunctionTask[]): Promise<TaskResult[]> {
  return Promise.all(
    tasks.map(async (task) => {
      await task.run({ log: () => {} }, new AbortController().signal)
      return { name: task.name, exitCode: null, signal: null, durationMs: 1, output: [], cancelled: false }
    }),
  )
}

function flow() {
  const reporter = { checkingRemotes: vi.fn(), created: vi.fn(), reposAdded: vi.fn() }
  return { ctx, name: 'demo', dir: '/ws/demo', options: {}, create: vi.fn(async () => handle), reporter }
}

/** Source → the `fetchRemoteBranch` each `addRepo` call got, in call order. */
function adds(): Record<string, boolean | undefined> {
  return Object.fromEntries(vi.mocked(addRepo).mock.calls.map((call) => [call[2].source, call[2].fetchRemoteBranch]))
}

let access = fakeRemoteAccess()

beforeEach(() => {
  access = fakeRemoteAccess({ pushed: ['app-src', 'infra-src'] })
  vi.mocked(prepareRemoteAccess).mockReset().mockImplementation(access)
  vi.mocked(addRepo).mockReset().mockImplementation(async (_ctx, _dir, options) => ({ source: options.source }) as never)
  vi.mocked(confirm).mockReset()
  vi.mocked(select).mockReset()
  vi.mocked(runTasks).mockReset().mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
})

describe('createFromPushedBranch — offering the repos that have the branch', () => {
  it('checks every registered repo once, then offers the ones whose remote has the branch', async () => {
    vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const f = flow()

    const result = await createFromPushedBranch(f, candidates)

    expect(f.reporter.checkingRemotes).toHaveBeenCalledWith(3)
    expect(prepareRemoteAccess).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prepareRemoteAccess).mock.calls[0]?.[2]).toEqual(['app-src', 'infra-src', 'docs-src'])
    expect(vi.mocked(confirm).mock.calls.map((call) => call[0].message)).toEqual([
      'Branch "demo" already exists on acme/app and infra. Create the workspace with those 2 repos?',
      'Add more repos to "demo"?',
    ])
    expect(adds()).toEqual({ 'app-src': true, 'infra-src': true })
    expect(f.reporter.created).toHaveBeenCalledWith(handle)
    expect(result.repoOutcomes.map((outcome) => outcome.source)).toEqual(['app-src', 'infra-src'])
    expect(select).not.toHaveBeenCalled()
    expect(access.close).toHaveBeenCalledTimes(1)
  })

  it('adds more from the rest of the registry, starting fresh, when asked to', async () => {
    vi.mocked(confirm).mockResolvedValue(true)
    vi.mocked(select).mockResolvedValue(['docs-src'])
    const f = flow()

    const result = await createFromPushedBranch(f, candidates)

    expect(vi.mocked(select).mock.calls[0]?.[0].options.map((option) => option.value)).toEqual(['docs-src'])
    expect(adds()).toEqual({ 'app-src': true, 'infra-src': true, 'docs-src': false })
    expect(f.reporter.reposAdded).toHaveBeenCalledTimes(2)
    expect(result.repoOutcomes).toHaveLength(3)
    expect(f.create).toHaveBeenCalledTimes(1)
  })

})

describe('createFromPushedBranch — after the offer', () => {
  it('keeps the workspace as it is when the extra pick is backed out of', async () => {
    vi.mocked(confirm).mockResolvedValue(true)
    vi.mocked(select).mockResolvedValue(null)

    const result = await createFromPushedBranch(flow(), candidates)

    expect(result.repoOutcomes).toHaveLength(2)
    expect(access.close).toHaveBeenCalledTimes(1)
  })

  it("doesn't ask to add more when every registered repo is already in", async () => {
    vi.mocked(confirm).mockResolvedValue(true)

    await createFromPushedBranch(flow(), candidates.slice(0, 2))

    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('names a single repo as "that repo"', async () => {
    vi.mocked(prepareRemoteAccess).mockImplementation(fakeRemoteAccess({ pushed: ['app-src'] }))
    vi.mocked(confirm).mockResolvedValue(false)
    vi.mocked(select).mockResolvedValue([])

    await createFromPushedBranch(flow(), candidates)

    expect(vi.mocked(confirm).mock.calls[0]?.[0].message).toBe(
      'Branch "demo" already exists on acme/app. Create the workspace with that repo?',
    )
  })
})

describe('createFromPushedBranch — the usual pick', () => {
  it('shows every registered repo when the offer is declined, still asking about the remote branch for those picked', async () => {
    vi.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    vi.mocked(select).mockResolvedValue(['app-src', 'docs-src'])

    await createFromPushedBranch(flow(), candidates)

    expect(vi.mocked(select).mock.calls[0]?.[0].options).toHaveLength(3)
    expect(vi.mocked(confirm).mock.calls[1]?.[0].message).toContain('Start from the remote branch?')
    expect(adds()).toEqual({ 'app-src': true, 'docs-src': false })
  })

  it("goes straight to the pick when no remote has the branch, or one that does can't use it", async () => {
    vi.mocked(prepareRemoteAccess).mockImplementation(fakeRemoteAccess({ pushed: ['app-src'], conflicts: { 'app-src': ['demo/x'] } }))
    vi.mocked(select).mockResolvedValue(['docs-src'])

    await createFromPushedBranch(flow(), candidates)

    expect(confirm).not.toHaveBeenCalled()
    expect(adds()).toEqual({ 'docs-src': false })
  })

  it('creates nothing, and forgets any key, when the pick is backed out of', async () => {
    vi.mocked(prepareRemoteAccess).mockImplementation(access)
    vi.mocked(confirm).mockResolvedValue(false)
    vi.mocked(select).mockResolvedValue(null)
    const f = flow()

    await expect(createFromPushedBranch(f, candidates)).rejects.toThrow(SporkError)
    expect(f.create).not.toHaveBeenCalled()
    expect(access.close).toHaveBeenCalledTimes(1)
  })
})

describe('listInWords', () => {
  it('joins with commas and a final "and"', () => {
    expect(listInWords(['a'])).toBe('a')
    expect(listInWords(['a', 'b'])).toBe('a and b')
    expect(listInWords(['a', 'b', 'c'])).toBe('a, b and c')
  })
})
