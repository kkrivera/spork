import { describe, expect, it } from 'vitest'
import { createAppContext } from '../src/context.js'

describe('createAppContext', () => {
  it('roots reposRoot/registryPath under ~/.spork and builds a Ui', () => {
    const ctx = createAppContext({ argv: ['--no-color'] })

    expect(ctx.reposRoot).toContain('.spork')
    expect(ctx.registryPath).toContain('.spork')
    expect(ctx.ui.isColorEnabled).toBe(false)
  })
})
