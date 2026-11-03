import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import { execSsh } from './exec.js'
import type { SshTarget } from './target.js'

/**
 * The key files ssh would try for `target` that have a passphrase and
 * aren't already loaded in the user's own ssh-agent, in the order ssh
 * tries them — the keys worth asking about after a connection failed on
 * authentication. A key that's already loaded is left out: if it didn't
 * get in, its passphrase isn't the problem. An unencrypted key is left
 * out too, since ssh already tries it without asking.
 *
 * Reads the config ssh really uses (`ssh -G`, after `~/.ssh/config`, so
 * a host alias's own `IdentityFile` is what's found). Returns nothing for
 * a host whose `IdentityAgent` is some other agent (1Password, Secretive):
 * its keys aren't files spork could unlock.
 */
export async function findLockedKeys(target: SshTarget): Promise<string[]> {
  const config = await resolveSshConfig(target)
  const agent = config.get('identityagent')?.[0]
  if (agent && agent.toLowerCase() !== 'ssh_auth_sock') return []

  const loaded = await loadedPublicKeys()
  const candidates = (config.get('identityfile') ?? [])
    .map((file) => expandPath(file, config))
    .filter((file): file is string => file !== null && existsSync(file))

  const locked: string[] = []
  for (const file of candidates) {
    if (locked.includes(file) || !(await isEncrypted(file))) continue
    if (loaded.has((await publicKeyOf(file)) ?? '')) continue
    locked.push(file)
  }
  return locked
}

/** `ssh -G`'s output as option → values (lowercased names; `identityfile` repeats). */
async function resolveSshConfig(target: SshTarget): Promise<Map<string, string[]>> {
  const args = ['-G', ...(target.port ? ['-p', String(target.port)] : []), ...(target.user ? ['-l', target.user] : []), target.host]
  const config = new Map<string, string[]>()
  for (const line of (await execSsh('ssh', args)).split('\n')) {
    const space = line.indexOf(' ')
    if (space <= 0) continue
    const name = line.slice(0, space).toLowerCase()
    config.set(name, [...(config.get(name) ?? []), line.slice(space + 1).trim()])
  }
  return config
}

/**
 * Expands the `~` and `%` tokens an `IdentityFile` may use (`ssh -G` prints
 * them as written). A token spork doesn't know gives null: better to skip
 * the file than guess at a path.
 */
function expandPath(file: string, config: Map<string, string[]>): string | null {
  const home = os.homedir()
  const tokens: Record<string, string> = {
    '%': '%',
    d: home,
    u: os.userInfo().username,
    h: config.get('hostname')?.[0] ?? '',
    r: config.get('user')?.[0] ?? '',
  }
  let unknown = false
  const expanded = file.replace(/^~(?=\/|$)/, home).replace(/%(.)/g, (_, token: string) => {
    if (token in tokens) return tokens[token] as string
    unknown = true
    return ''
  })
  return unknown ? null : expanded
}

/** `ssh-keygen -y` with an empty passphrase only fails on a key that has one. */
async function isEncrypted(file: string): Promise<boolean> {
  try {
    await execSsh('ssh-keygen', ['-y', '-P', '', '-f', file])
    return false
  } catch {
    return true
  }
}

/** The `type base64` part of the key's `.pub` next to it, or null without one. */
async function publicKeyOf(file: string): Promise<string | null> {
  try {
    return normalizePublicKey(await readFile(`${file}.pub`, 'utf8'))
  } catch {
    return null
  }
}

/** Every public key in the user's own agent; empty when it has none, or there's no agent at all. */
async function loadedPublicKeys(): Promise<Set<string>> {
  try {
    const listed = await execSsh('ssh-add', ['-L'])
    return new Set(listed.split('\n').map(normalizePublicKey).filter((key) => key !== ''))
  } catch {
    return new Set()
  }
}

function normalizePublicKey(line: string): string {
  return line.trim().split(/\s+/).slice(0, 2).join(' ')
}
