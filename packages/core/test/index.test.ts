import { describe, expect, it } from 'vitest'
import * as core from '../src/index.js'

describe('public exports', () => {
  it('exposes the workspace lifecycle API', () => {
    expect(core.createWorkspace).toBeInstanceOf(Function)
    expect(core.addRepo).toBeInstanceOf(Function)
    expect(core.removeRepo).toBeInstanceOf(Function)
    expect(core.removeWorkspace).toBeInstanceOf(Function)
    expect(core.reconcileWorkspace).toBeInstanceOf(Function)
    expect(core.getWorkspaceStatus).toBeInstanceOf(Function)
    expect(core.SporkError).toBeInstanceOf(Function)
  })
})
