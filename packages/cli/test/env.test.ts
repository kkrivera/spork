import { describe, expect, it } from 'vitest'
import { readSporkEnv } from '../src/env.js'

describe('readSporkEnv', () => {
  it('reads SPORK_WORKSPACE_DIR', () => {
    expect(readSporkEnv({ SPORK_WORKSPACE_DIR: '/custom/dir' })).toEqual({ workspaceDir: '/custom/dir' })
  })

  it('leaves workspaceDir undefined when unset', () => {
    expect(readSporkEnv({})).toEqual({ workspaceDir: undefined })
  })

  it('treats an empty string the same as unset', () => {
    expect(readSporkEnv({ SPORK_WORKSPACE_DIR: '' })).toEqual({ workspaceDir: undefined })
  })
})
