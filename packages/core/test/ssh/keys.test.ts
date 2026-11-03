import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/ssh/exec.js', () => ({ execSsh: vi.fn() }))

const { execSsh } = await import('../../src/ssh/exec.js')
const { findLockedKeys } = await import('../../src/ssh/keys.js')

const execSshMock = vi.mocked(execSsh)
const TARGET = { host: 'github.com', user: 'git' }

let dir: string

interface FakeSsh {
  /** Extra `ssh -G` lines besides the identity files. */
  config?: string[]
  identityFiles: string[]
  /** Key files `ssh-keygen -y -P ''` succeeds on. */
  unencrypted?: string[]
  /** `ssh-add -L` output lines, or null for "no agent at all". */
  loaded?: string[] | null
}

function fakeSsh({ config = [], identityFiles, unencrypted = [], loaded = [] }: FakeSsh): void {
  execSshMock.mockImplementation(async (tool, args) => {
    if (tool === 'ssh') return [...config, ...identityFiles.map((file) => `identityfile ${file}`)].join('\n')
    if (tool === 'ssh-keygen') {
      if (unencrypted.includes(args[args.length - 1] as string)) return 'ssh-ed25519 AAAA'
      throw new Error('incorrect passphrase supplied to decrypt private key')
    }
    if (loaded === null) throw new Error('Could not open a connection to your authentication agent.')
    if (loaded.length === 0) throw new Error('The agent has no identities.')
    return loaded.join('\n')
  })
}

/** Creates a private key file (and optionally its .pub) and returns its path. */
async function key(name: string, publicKey?: string): Promise<string> {
  const file = path.join(dir, name)
  await writeFile(file, 'PRIVATE')
  if (publicKey) await writeFile(`${file}.pub`, `${publicKey} comment\n`)
  return file
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spork-keys-'))
  execSshMock.mockReset()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('findLockedKeys', () => {
  it("returns only key files that exist and have a passphrase, in ssh's order", async () => {
    const work = await key('id_work')
    const plain = await key('id_plain')
    const other = await key('id_other')
    fakeSsh({ identityFiles: [work, path.join(dir, 'missing'), plain, other], unencrypted: [plain] })

    expect(await findLockedKeys(TARGET)).toEqual([work, other])
  })

  it("resolves the user's real ssh config for the host, user, and port", async () => {
    fakeSsh({ identityFiles: [] })

    await findLockedKeys({ host: 'example.com', user: 'git', port: 2222 })

    expect(execSshMock).toHaveBeenCalledWith('ssh', ['-G', '-p', '2222', '-l', 'git', 'example.com'])
  })

  it('leaves out a key already loaded in the user\'s agent, matched by its .pub', async () => {
    const loaded = await key('id_loaded', 'ssh-ed25519 AAAALOADED')
    const locked = await key('id_locked', 'ssh-ed25519 AAAALOCKED')
    fakeSsh({ identityFiles: [loaded, locked], loaded: ['ssh-ed25519 AAAALOADED user@laptop'] })

    expect(await findLockedKeys(TARGET)).toEqual([locked])
  })

  it('treats no agent at all as nothing loaded', async () => {
    const locked = await key('id_locked', 'ssh-ed25519 AAAALOCKED')
    fakeSsh({ identityFiles: [locked], loaded: null })

    expect(await findLockedKeys(TARGET)).toEqual([locked])
  })

  it('finds nothing for a host that uses some other agent, like 1Password', async () => {
    fakeSsh({ config: ['identityagent ~/Library/1password/agent.sock'], identityFiles: [await key('id_rsa')] })

    expect(await findLockedKeys(TARGET)).toEqual([])
  })

  it('still looks when IdentityAgent just names SSH_AUTH_SOCK', async () => {
    const locked = await key('id_rsa')
    fakeSsh({ config: ['identityagent SSH_AUTH_SOCK'], identityFiles: [locked] })

    expect(await findLockedKeys(TARGET)).toEqual([locked])
  })

  it('expands ~ and %-tokens, skips unknown tokens, and lists a key only once', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(dir)
    const home = await key('id_home')
    const byHost = await key('id_github.com')
    fakeSsh({
      config: ['hostname github.com'],
      identityFiles: ['~/id_home', '%d/id_home', '%d/id_%h', '%d/id_%C'],
    })

    expect(await findLockedKeys(TARGET)).toEqual([home, byHost])
  })
})
