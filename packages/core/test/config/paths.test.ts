import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:os', () => ({
  default: { homedir: () => '/home/user' },
  homedir: () => '/home/user',
}))

const { SPORK_HOME, REPOS_ROOT, REGISTRY_PATH } = await import('../../src/config/paths.js')

describe('paths', () => {
  it('roots everything under ~/.spork', () => {
    expect(SPORK_HOME).toBe(path.join('/home/user', '.spork'))
    expect(REPOS_ROOT).toBe(path.join(SPORK_HOME, 'repos'))
    expect(REGISTRY_PATH).toBe(path.join(SPORK_HOME, 'workspaces.json'))
  })
})
