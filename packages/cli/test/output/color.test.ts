import { describe, expect, it } from 'vitest'
import { createUi, resolveColorEnabled } from '../../src/output/color.js'

describe('resolveColorEnabled', () => {
  it('is disabled by --no-color regardless of everything else', () => {
    expect(resolveColorEnabled({ argv: ['--no-color'], env: {}, isTTY: true })).toBe(false)
  })

  it('is enabled by --color regardless of everything else', () => {
    expect(resolveColorEnabled({ argv: ['--color'], env: { NO_COLOR: '1' }, isTTY: false })).toBe(true)
  })

  it('honors NO_COLOR being present, regardless of its value', () => {
    expect(resolveColorEnabled({ argv: [], env: { NO_COLOR: '' }, isTTY: true })).toBe(false)
  })

  it('disables color in CI even on a TTY', () => {
    expect(resolveColorEnabled({ argv: [], env: { CI: 'true' }, isTTY: true })).toBe(false)
  })

  it('falls back to whether stdout is a TTY', () => {
    expect(resolveColorEnabled({ argv: [], env: {}, isTTY: true })).toBe(true)
    expect(resolveColorEnabled({ argv: [], env: {}, isTTY: false })).toBe(false)
  })

  it('reads real process.argv/env/isTTY when no options are given', () => {
    expect(typeof resolveColorEnabled()).toBe('boolean')
  })
})

describe('createUi', () => {
  it('produces working color functions when enabled', () => {
    const ui = createUi({ argv: ['--color'], env: {}, isTTY: false })

    expect(ui.isColorEnabled).toBe(true)
    expect(ui.color.red('x')).not.toBe('x')
  })

  it('produces plain-text passthrough functions when disabled', () => {
    const ui = createUi({ argv: ['--no-color'], env: {}, isTTY: true })

    expect(ui.isColorEnabled).toBe(false)
    expect(ui.color.red('x')).toBe('x')
  })
})
