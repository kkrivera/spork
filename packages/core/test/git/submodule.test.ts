import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/git/exec.js', () => ({
  execGit: vi.fn(),
}))

const { execGit } = await import('../../src/git/exec.js')
const { hasSubmodules, initSubmodules } = await import('../../src/git/submodule.js')

const execGitMock = vi.mocked(execGit)

let worktreePath: string

beforeEach(async () => {
  worktreePath = await mkdtemp(path.join(os.tmpdir(), 'spork-submodule-'))
  execGitMock.mockReset().mockResolvedValue({ stdout: '', stderr: '' })
})

afterEach(async () => {
  await rm(worktreePath, { recursive: true, force: true })
})

describe('hasSubmodules', () => {
  it('is false when there is no .gitmodules file', () => {
    expect(hasSubmodules(worktreePath)).toBe(false)
  })

  it('is true once a .gitmodules file exists', async () => {
    await writeFile(path.join(worktreePath, '.gitmodules'), '[submodule "x"]\n', 'utf8')

    expect(hasSubmodules(worktreePath)).toBe(true)
  })
})

describe('initSubmodules', () => {
  it('runs a recursive submodule update --init in the worktree', async () => {
    await initSubmodules(worktreePath)

    expect(execGitMock).toHaveBeenCalledWith(['submodule', 'update', '--init', '--recursive'], { cwd: worktreePath })
  })
})
