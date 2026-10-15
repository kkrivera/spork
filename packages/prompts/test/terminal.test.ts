import { EventEmitter } from 'node:events'
import pc from 'picocolors'
import { describe, expect, it } from 'vitest'
import { runConfirmPrompt, runSelectPrompt } from '../src/terminal.js'
import { createInitialState } from '../src/state.js'
import type { NodeKeypress, PromptInputStream, PromptOption, PromptOutputStream } from '../src/types.js'

const colors = pc.createColors(false)
const OPTIONS: PromptOption<string>[] = [
  { label: 'widgets', value: 'widgets' },
  { label: 'gadgets', value: 'gadgets' },
]

class FakeInput extends EventEmitter implements PromptInputStream {
  isTTY = true
  rawMode: boolean | null = null
  resumed = false

  setRawMode(mode: boolean): void {
    this.rawMode = mode
  }

  resume(): void {
    this.resumed = true
  }

  pause(): void {
    this.resumed = false
  }

  press(str: string | undefined, key: Partial<NodeKeypress> = {}): void {
    this.emit('keypress', str, { ctrl: false, meta: false, shift: false, ...key })
  }
}

class FakeOutput extends EventEmitter implements PromptOutputStream {
  isTTY = true
  columns: number | undefined = 80
  rows: number | undefined = 24
  writes: string[] = []

  write(chunk: string): boolean {
    this.writes.push(chunk)
    return true
  }
}

function start(mode: 'single' | 'multi' = 'multi') {
  const input = new FakeInput()
  const output = new FakeOutput()
  const promise = runSelectPrompt(createInitialState(OPTIONS, mode), 'Pick repos', input, output, colors)
  return { input, output, promise }
}

describe('runSelectPrompt — startup', () => {
  it('hides the cursor, enables raw mode, and draws the first frame', () => {
    const { input, output } = start()

    expect(output.writes[0]).toBe('\x1b[?25l')
    expect(input.rawMode).toBe(true)
    expect(input.resumed).toBe(true)
    expect(output.writes.some((w) => w.includes('widgets'))).toBe(true)
  })

  it('falls back to 80x24 when the output reports no size', () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    output.columns = undefined
    output.rows = undefined

    expect(() => runSelectPrompt(createInitialState(OPTIONS, 'multi'), 'Pick repos', input, output, colors)).not.toThrow()
  })
})

describe('runSelectPrompt — interaction', () => {
  it('redraws after a navigation keypress', async () => {
    const { input, output, promise } = start()
    const before = output.writes.length

    input.press(undefined, { name: 'down' })

    expect(output.writes.length).toBeGreaterThan(before)
    input.press(undefined, { name: 'escape' })
    await promise
  })

  it('redraws on an output resize event', () => {
    const { output } = start()
    const before = output.writes.length

    output.emit('resize')

    expect(output.writes.length).toBeGreaterThan(before)
  })

  it('ignores an unrecognized key without redrawing', () => {
    const { input, output } = start()
    const before = output.writes.length

    input.press(undefined, { name: 'f1' })

    expect(output.writes.length).toBe(before)
  })
})

describe('runSelectPrompt — settling', () => {
  it('resolves with the confirmed state and restores the terminal', async () => {
    const { input, output, promise } = start()

    input.press(' ') // select widgets
    input.press(undefined, { name: 'return' })

    const state = await promise
    expect(state.done).toBe('confirmed')
    expect(input.rawMode).toBe(false)
    expect(input.resumed).toBe(false)
    expect(output.writes.at(-1)).toBe('\x1b[?25h')
  })

  it('resolves with a cancelled state on escape', async () => {
    const { input, promise } = start()

    input.press(undefined, { name: 'escape' })

    const state = await promise
    expect(state.done).toBe('cancelled')
  })

  it('stops listening for further keypresses once settled', async () => {
    const { input, output, promise } = start()
    input.press(undefined, { name: 'escape' })
    await promise
    const before = output.writes.length

    input.press(undefined, { name: 'down' })

    expect(output.writes.length).toBe(before)
  })
})

describe('runConfirmPrompt — startup', () => {
  it('hides the cursor, enables raw mode, and writes the prompt with the default-aware hint', () => {
    const input = new FakeInput()
    const output = new FakeOutput()

    void runConfirmPrompt('Open now?', true, input, output, colors)

    expect(output.writes[0]).toBe('\x1b[?25l' + 'Open now? (Y/n) ')
    expect(input.rawMode).toBe(true)
  })
})

describe('runConfirmPrompt — answering', () => {
  it('answers true immediately on "y", restoring the terminal', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const promise = runConfirmPrompt('Open now?', false, input, output, colors)

    input.press('y')

    expect(await promise).toBe(true)
    expect(input.rawMode).toBe(false)
    expect(input.resumed).toBe(false)
    expect(output.writes.at(-1)).toContain('Yes')
    expect(output.writes.at(-1)).toContain('\x1b[?25h')
  })

  it('answers false immediately on "n"', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const promise = runConfirmPrompt('Open now?', true, input, output, colors)

    input.press('n')

    expect(await promise).toBe(false)
  })

  it('enter accepts the default value', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const promise = runConfirmPrompt('Open now?', true, input, output, colors)

    input.press(undefined, { name: 'return' })

    expect(await promise).toBe(true)
  })
})

describe('runConfirmPrompt — cancel-like keys', () => {
  it('escape resolves false regardless of the default', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const promise = runConfirmPrompt('Open now?', true, input, output, colors)

    input.press(undefined, { name: 'escape' })

    expect(await promise).toBe(false)
  })

  it('ctrl+c resolves false regardless of the default', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const promise = runConfirmPrompt('Open now?', true, input, output, colors)

    input.press('c', { name: 'c', ctrl: true })

    expect(await promise).toBe(false)
  })

  it('ignores an unrecognized key and keeps waiting', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const promise = runConfirmPrompt('Open now?', true, input, output, colors)

    input.press('q')
    input.press(undefined, { name: 'return' })

    expect(await promise).toBe(true)
  })
})
