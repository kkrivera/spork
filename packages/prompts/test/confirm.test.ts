import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { confirm } from '../src/confirm.js'
import { NotInteractiveError } from '../src/types.js'
import type { NodeKeypress, PromptInputStream, PromptOutputStream } from '../src/types.js'

class FakeInput extends EventEmitter implements PromptInputStream {
  isTTY: boolean

  constructor(isTTY = true) {
    super()
    this.isTTY = isTTY
  }

  setRawMode(): void {}
  resume(): void {}
  pause(): void {}

  press(str: string | undefined, key: Partial<NodeKeypress> = {}): void {
    this.emit('keypress', str, { ctrl: false, meta: false, shift: false, ...key })
  }
}

class FakeOutput extends EventEmitter implements PromptOutputStream {
  isTTY: boolean
  columns = 80
  rows = 24

  constructor(isTTY = true) {
    super()
    this.isTTY = isTTY
  }

  write(): boolean {
    return true
  }
}

describe('confirm — non-interactive', () => {
  it('throws NotInteractiveError synchronously when input is not a TTY', async () => {
    await expect(confirm({ message: 'Open?', input: new FakeInput(false), output: new FakeOutput() })).rejects.toThrow(
      NotInteractiveError,
    )
  })

  it('throws NotInteractiveError when output is not a TTY', async () => {
    await expect(confirm({ message: 'Open?', input: new FakeInput(), output: new FakeOutput(false) })).rejects.toThrow(
      NotInteractiveError,
    )
  })

  it('defaults to process.stdin/stdout when none are given (neither is a TTY under the test runner)', async () => {
    await expect(confirm({ message: 'Open?' })).rejects.toThrow(NotInteractiveError)
  })
})

describe('confirm — interactive', () => {
  it('resolves true on "y"', async () => {
    const input = new FakeInput()
    const resultPromise = confirm({ message: 'Open?', input, output: new FakeOutput() })

    input.press('y')

    expect(await resultPromise).toBe(true)
  })

  it('resolves false on "n"', async () => {
    const input = new FakeInput()
    const resultPromise = confirm({ message: 'Open?', input, output: new FakeOutput() })

    input.press('n')

    expect(await resultPromise).toBe(false)
  })

  it('defaults to true on enter when no defaultValue is given', async () => {
    const input = new FakeInput()
    const resultPromise = confirm({ message: 'Open?', input, output: new FakeOutput() })

    input.press(undefined, { name: 'return' })

    expect(await resultPromise).toBe(true)
  })

  it('honors an explicit defaultValue of false on enter', async () => {
    const input = new FakeInput()
    const resultPromise = confirm({ message: 'Open?', defaultValue: false, input, output: new FakeOutput() })

    input.press(undefined, { name: 'return' })

    expect(await resultPromise).toBe(false)
  })

  it('resolves false on escape', async () => {
    const input = new FakeInput()
    const resultPromise = confirm({ message: 'Open?', input, output: new FakeOutput() })

    input.press(undefined, { name: 'escape' })

    expect(await resultPromise).toBe(false)
  })
})
