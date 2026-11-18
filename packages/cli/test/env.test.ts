import { describe, expect, it } from 'vitest'
import { readSporkEnv } from '../src/env.js'

describe('readSporkEnv', () => {
  it('reads SPORK_WORKSPACE_DIR', () => {
    expect(readSporkEnv({ SPORK_WORKSPACE_DIR: '/custom/dir' })).toEqual({ workspaceDir: '/custom/dir', cdFile: undefined })
  })

  it('reads SPORK_CD_FILE', () => {
    expect(readSporkEnv({ SPORK_CD_FILE: '/tmp/spork-cd.x' }).cdFile).toBe('/tmp/spork-cd.x')
  })

  it('leaves both undefined when unset', () => {
    expect(readSporkEnv({})).toEqual({ workspaceDir: undefined, cdFile: undefined })
  })

  it('treats an empty string the same as unset', () => {
    expect(readSporkEnv({ SPORK_WORKSPACE_DIR: '', SPORK_CD_FILE: '' })).toEqual({ workspaceDir: undefined, cdFile: undefined })
  })
})
