import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { select } from '../src/select.js'
import { NotInteractiveError } from '../src/types.js'
import type { NodeKeypress, PromptInputStream, PromptOption, PromptOutputStream } from '../src/types.js'

const OPTIONS: PromptOption<string>[] = [
  { label: 'widgets', value: 'widgets' },
  { label: 'gadgets', value: 'gadgets' },
]

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

describe('select — non-interactive', () => {
  it('throws NotInteractiveError synchronously when input is not a TTY', async () => {
    await expect(
      select({ message: 'Pick', options: OPTIONS, mode: 'multi', input: new FakeInput(false), output: new FakeOutput() }),
    ).rejects.toThrow(NotInteractiveError)
  })

  it('throws NotInteractiveError when output is not a TTY', async () => {
    await expect(
      select({ message: 'Pick', options: OPTIONS, mode: 'multi', input: new FakeInput(), output: new FakeOutput(false) }),
    ).rejects.toThrow(NotInteractiveError)
  })

  it('defaults to process.stdin/stdout when none are given (neither is a TTY under the test runner)', async () => {
    await expect(select({ message: 'Pick', options: OPTIONS, mode: 'multi' })).rejects.toThrow(NotInteractiveError)
  })
})

describe('select — interactive', () => {
  it('resolves with the selected values on confirm', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()

    const resultPromise = select({ message: 'Pick', options: OPTIONS, mode: 'multi', input, output })
    input.press(' ')
    input.press(undefined, { name: 'return' })

    expect(await resultPromise).toEqual(['widgets'])
  })

  it('resolves with null on cancel', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()

    const resultPromise = select({ message: 'Pick', options: OPTIONS, mode: 'multi', input, output })
    input.press(undefined, { name: 'escape' })

    expect(await resultPromise).toBeNull()
  })

  it('selects a single value immediately on enter in single-select mode', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()

    const resultPromise = select({ message: 'Pick', options: OPTIONS, mode: 'single', input, output })
    input.press(undefined, { name: 'down' })
    input.press(undefined, { name: 'return' })

    expect(await resultPromise).toEqual(['gadgets'])
  })
})
