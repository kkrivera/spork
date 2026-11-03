import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()
const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (error: unknown, result: unknown) => void
    execFileMock(...args.slice(0, -1))
      .then((result: unknown) => callback(null, result))
      .catch((error: unknown) => callback(error, null))
  },
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

const { execSsh, runSshAddOnTerminal, spawnSshAgent } = await import('../../src/ssh/exec.js')

function fakeChild(): EventEmitter {
  const child = new EventEmitter()
  spawnMock.mockReturnValue(child)
  return child
}

beforeEach(() => {
  execFileMock.mockReset()
  spawnMock.mockReset()
})

describe('execSsh', () => {
  it("returns stdout, inheriting the environment and the user's own agent by default", async () => {
    execFileMock.mockResolvedValue({ stdout: 'hostname github.com\n', stderr: '' })

    expect(await execSsh('ssh', ['-G', 'github.com'])).toBe('hostname github.com\n')
    expect(execFileMock).toHaveBeenCalledWith('ssh', ['-G', 'github.com'], {})
  })

  it('points the tool at another agent when given its socket', async () => {
    execFileMock.mockResolvedValue({ stdout: '', stderr: '' })

    await execSsh('ssh-add', ['-L'], '/tmp/agent.sock')

    const [, , options] = execFileMock.mock.calls[0] as [string, string[], { env: Record<string, string> }]
    expect(options.env.SSH_AUTH_SOCK).toBe('/tmp/agent.sock')
    expect(options.env.PATH).toBe(process.env.PATH)
  })

  it('rejects on a non-zero exit', async () => {
    execFileMock.mockRejectedValue(new Error('exit 255'))

    await expect(execSsh('ssh-keygen', ['-y'])).rejects.toThrow('exit 255')
  })
})

describe('runSshAddOnTerminal', () => {
  it('runs ssh-add on the terminal, against the given agent, never through an askpass program', async () => {
    const child = fakeChild()

    const added = runSshAddOnTerminal(['-q', '/k'], '/tmp/agent.sock')
    child.emit('exit', 0)

    expect(await added).toBe(true)
    const [tool, args, options] = spawnMock.mock.calls[0] as [string, string[], { stdio: string; env: Record<string, string> }]
    expect([tool, args, options.stdio]).toEqual(['ssh-add', ['-q', '/k'], 'inherit'])
    expect(options.env).toMatchObject({ SSH_AUTH_SOCK: '/tmp/agent.sock', SSH_ASKPASS_REQUIRE: 'never' })
  })

  it('resolves false when ssh-add exits non-zero or fails to start', async () => {
    const skipped = fakeChild()
    const first = runSshAddOnTerminal(['/k'], '/s')
    skipped.emit('exit', 1)

    const missing = fakeChild()
    const second = runSshAddOnTerminal(['/k'], '/s')
    missing.emit('error', new Error('ENOENT'))

    expect([await first, await second]).toEqual([false, false])
  })
})

describe('spawnSshAgent', () => {
  it('starts ssh-agent with its output discarded', () => {
    const child = fakeChild()

    expect(spawnSshAgent(['-D'])).toBe(child)
    expect(spawnMock).toHaveBeenCalledWith('ssh-agent', ['-D'], { stdio: 'ignore' })
  })
})
