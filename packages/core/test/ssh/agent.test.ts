import { EventEmitter } from 'node:events'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/ssh/exec.js', () => ({ spawnSshAgent: vi.fn(), runSshAddOnTerminal: vi.fn() }))

const { spawnSshAgent, runSshAddOnTerminal } = await import('../../src/ssh/exec.js')
const { startTemporaryAgent } = await import('../../src/ssh/agent.js')

const spawnSshAgentMock = vi.mocked(spawnSshAgent)
const runSshAddMock = vi.mocked(runSshAddOnTerminal)

/** A stand-in for the `ssh-agent -D` child: opens its socket file at once (unless told not to), exits when killed. */
class FakeAgent extends EventEmitter {
  exitCode: number | null = null
  signalCode: string | null = null
  kill = vi.fn(() => {
    this.signalCode = 'SIGTERM'
    setImmediate(() => this.emit('exit', null, 'SIGTERM'))
    return true
  })
}

function fakeAgent(behavior: 'opens' | 'exits' | 'fails-to-spawn' = 'opens'): FakeAgent {
  const child = new FakeAgent()
  spawnSshAgentMock.mockImplementation((args) => {
    if (behavior === 'opens') writeFileSync(args[2] as string, '')
    if (behavior === 'exits') setImmediate(() => child.emit('exit', 2, null))
    if (behavior === 'fails-to-spawn') setImmediate(() => child.emit('error', new Error('spawn ssh-agent ENOENT')))
    return child as never
  })
  return child
}

beforeEach(() => {
  spawnSshAgentMock.mockReset()
  runSshAddMock.mockReset()
})

describe('startTemporaryAgent', () => {
  it('starts ssh-agent attached to spork, with a key lifetime, in a private temp directory', async () => {
    fakeAgent()

    const agent = await startTemporaryAgent()

    const dir = path.dirname(agent.socket)
    expect(dir.startsWith(path.join(os.tmpdir(), 'spork-agent-'))).toBe(true)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(spawnSshAgentMock).toHaveBeenCalledWith(['-D', '-a', agent.socket, '-t', '3600'])
    await agent.stop()
  })

  it('has ssh-add ask for a key on the terminal, against this agent only', async () => {
    fakeAgent()
    runSshAddMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const agent = await startTemporaryAgent()

    expect(await agent.unlock('/home/me/.ssh/id_rsa')).toBe(true)
    expect(await agent.unlock('/home/me/.ssh/id_other')).toBe(false)
    expect(runSshAddMock).toHaveBeenCalledWith(['-q', '/home/me/.ssh/id_rsa'], agent.socket)
    await agent.stop()
  })

  it('stops the agent and removes its directory, and is safe to stop twice', async () => {
    const child = fakeAgent()
    const agent = await startTemporaryAgent()

    await agent.stop()
    await agent.stop()

    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(existsSync(path.dirname(agent.socket))).toBe(false)
  })

  it('stops the agent on process exit if nothing else did', async () => {
    const child = fakeAgent()
    const listeners = process.listenerCount('exit')
    const agent = await startTemporaryAgent()

    expect(process.listenerCount('exit')).toBe(listeners + 1)
    process.listeners('exit').at(-1)?.call(process, 0)

    expect(child.kill).toHaveBeenCalled()
    expect(existsSync(path.dirname(agent.socket))).toBe(false)
    await agent.stop()
    expect(process.listenerCount('exit')).toBe(listeners)
  })

  it('rejects, and cleans up, if the agent exits before opening its socket', async () => {
    fakeAgent('exits')
    const listeners = process.listenerCount('exit')

    await expect(startTemporaryAgent()).rejects.toThrow("Couldn't start a temporary ssh-agent: it exited with code 2")
    expect(process.listenerCount('exit')).toBe(listeners)
  })

  it('rejects if ssh-agent is not installed', async () => {
    fakeAgent('fails-to-spawn')

    await expect(startTemporaryAgent()).rejects.toThrow('spawn ssh-agent ENOENT')
  })
})
