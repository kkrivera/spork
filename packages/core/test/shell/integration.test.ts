import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  hasShellIntegration,
  installShellIntegration,
  shellFromPath,
  shellInitLine,
  shellInitScript,
  shellRcPath,
} from '../../src/shell/integration.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spork-shell-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('shellFromPath', () => {
  it('recognizes zsh, bash and fish by name, wherever they live', () => {
    expect(shellFromPath('/opt/homebrew/bin/zsh')).toBe('zsh')
    expect(shellFromPath('/bin/bash')).toBe('bash')
    expect(shellFromPath('/usr/local/bin/fish')).toBe('fish')
  })

  it('is null for any other shell, or none', () => {
    expect(shellFromPath('/bin/sh')).toBeNull()
    expect(shellFromPath('/usr/bin/nu')).toBeNull()
    expect(shellFromPath(undefined)).toBeNull()
  })
})

describe('shellRcPath', () => {
  it("is each shell's interactive startup file", () => {
    expect(shellRcPath('zsh', {}, '/home/k')).toBe('/home/k/.zshrc')
    expect(shellRcPath('bash', {}, '/home/k')).toBe('/home/k/.bashrc')
    expect(shellRcPath('fish', {}, '/home/k')).toBe('/home/k/.config/fish/config.fish')
  })

  it('follows ZDOTDIR and XDG_CONFIG_HOME', () => {
    expect(shellRcPath('zsh', { ZDOTDIR: '/z' }, '/home/k')).toBe('/z/.zshrc')
    expect(shellRcPath('fish', { XDG_CONFIG_HOME: '/x' }, '/home/k')).toBe('/x/fish/config.fish')
  })

  it('defaults to the real environment and home directory', () => {
    expect(shellRcPath('bash')).toBe(path.join(os.homedir(), '.bashrc'))
  })
})

describe('shellInitScript / shellInitLine', () => {
  it('defines a spork function that runs the real spork with SPORK_CD_FILE, then cds', () => {
    for (const shell of ['zsh', 'bash', 'fish'] as const) {
      const script = shellInitScript(shell)
      expect(script).toContain('SPORK_CD_FILE=')
      expect(script).toContain('command spork')
      expect(script).toMatch(/\bcd\b/)
    }
    expect(shellInitScript('zsh')).toBe(shellInitScript('bash'))
    expect(shellInitScript('fish')).toContain('function spork')
  })

  it('loads the integration quietly, and only when spork is installed', () => {
    expect(shellInitLine('zsh')).toBe('command -v spork >/dev/null 2>&1 && eval "$(spork shell-init zsh 2>/dev/null)"')
    expect(shellInitLine('fish')).toBe('command -q spork; and spork shell-init fish 2>/dev/null | source')
  })
})

describe('hasShellIntegration / installShellIntegration', () => {
  it('appends the line to an existing file, on its own line', async () => {
    const rc = path.join(dir, '.zshrc')
    await writeFile(rc, 'export A=1')
    expect(await hasShellIntegration(rc)).toBe(false)

    await installShellIntegration(rc, 'zsh')

    expect(await readFile(rc, 'utf8')).toBe(`export A=1\n\n# Lets \`spork workspace open\` change this shell's folder.\n${shellInitLine('zsh')}\n`)
    expect(await hasShellIntegration(rc)).toBe(true)
  })

  it('separates it from a file that already ends in a newline with one blank line', async () => {
    const rc = path.join(dir, '.bashrc')
    await writeFile(rc, 'export A=1\n')

    await installShellIntegration(rc, 'bash')

    expect(await readFile(rc, 'utf8')).toMatch(/^export A=1\n\n# Lets/)
  })

  it('creates a missing file and its folder', async () => {
    const rc = path.join(dir, 'fish', 'config.fish')
    expect(await hasShellIntegration(rc)).toBe(false)

    await installShellIntegration(rc, 'fish')

    expect(await readFile(rc, 'utf8')).toMatch(/^# Lets/)
  })

  it('writes an empty file without a leading blank line', async () => {
    const rc = path.join(dir, '.zshrc')
    await writeFile(rc, '')

    await installShellIntegration(rc, 'zsh')

    expect(await readFile(rc, 'utf8')).toMatch(/^# Lets/)
  })
})
