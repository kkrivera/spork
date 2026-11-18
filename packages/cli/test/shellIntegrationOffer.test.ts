import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/prompts', () => ({
  confirm: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { confirm, NotInteractiveError } = await import('@spork/prompts')
const { offerShellIntegration } = await import('../src/shellIntegrationOffer.js')
const { createUi } = await import('../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

let dir: string
let deps: { env: NodeJS.ProcessEnv; preferencesPath: string }
let rc: string
let logs: string[]

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spork-offer-'))
  deps = { env: { SHELL: '/bin/zsh', ZDOTDIR: dir }, preferencesPath: path.join(dir, 'preferences.json') }
  rc = path.join(dir, '.zshrc')
  logs = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line))
  vi.mocked(confirm).mockReset()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const offered = async () => JSON.parse(await readFile(deps.preferencesPath, 'utf8')).shellIntegrationOffered

describe('offerShellIntegration', () => {
  it('adds the line to the startup file on yes, and remembers it asked', async () => {
    vi.mocked(confirm).mockResolvedValue(true)

    await offerShellIntegration(ctx, deps)

    expect(vi.mocked(confirm).mock.calls[0]?.[0].message).toContain('Add one line to')
    expect(await readFile(rc, 'utf8')).toContain('eval "$(spork shell-init zsh 2>/dev/null)"')
    expect(await offered()).toBe(true)
    expect(logs.join('\n')).toContain('Added to')
  })

  it('leaves the file alone on no, says how to add it later, and never asks again', async () => {
    vi.mocked(confirm).mockResolvedValue(false)

    await offerShellIntegration(ctx, deps)
    await offerShellIntegration(ctx, deps)

    expect(confirm).toHaveBeenCalledTimes(1)
    await expect(readFile(rc, 'utf8')).rejects.toThrow()
    expect(logs.join('\n')).toContain('spork shell-init zsh')
  })

  it("doesn't ask when the line is already there, or for an unsupported shell", async () => {
    await writeFile(rc, 'eval "$(spork shell-init zsh)"\n')
    await offerShellIntegration(ctx, deps)
    await offerShellIntegration(ctx, { ...deps, env: { SHELL: '/bin/sh' } })
    await offerShellIntegration(ctx, { ...deps, env: {} })

    expect(confirm).not.toHaveBeenCalled()
  })

  it("doesn't ask, or remember asking, without a terminal", async () => {
    vi.mocked(confirm).mockRejectedValue(new NotInteractiveError())

    await offerShellIntegration(ctx, deps)

    await expect(readFile(deps.preferencesPath, 'utf8')).rejects.toThrow()
  })

  it('re-throws a real prompt failure', async () => {
    vi.mocked(confirm).mockRejectedValue(new Error('stdin closed'))

    await expect(offerShellIntegration(ctx, deps)).rejects.toThrow('stdin closed')
  })
})
