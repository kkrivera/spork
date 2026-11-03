import { vi } from 'vitest'
import type { RemoteAccessSession, RepoRemoteAccess } from '@spork/core'

export interface FakeRemoteAccess {
  (ctx: unknown, workspaceDir: string, sources: readonly string[]): Promise<RemoteAccessSession>
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
}

/**
 * A stand-in for `@spork/core`'s `prepareRemoteAccess`: every repo is
 * reachable; `pushed` ones already have the workspace branch, and
 * `sockets` ones are reachable only through a temporary agent, and
 * `conflicts` ones have branches clashing with the workspace's.
 */
export function fakeRemoteAccess(
  options: { pushed?: string[]; sockets?: Record<string, string>; conflicts?: Record<string, string[]> } = {},
): FakeRemoteAccess {
  const close = vi.fn(async () => {})
  const fake = async (_ctx: unknown, _workspaceDir: string, sources: readonly string[]): Promise<RemoteAccessSession> => ({
    repos: sources.map((source): RepoRemoteAccess => {
      const sshAuthSock = options.sockets?.[source]
      return {
        source,
        status: 'ok',
        hasBranch: options.pushed?.includes(source) ?? false,
        conflicts: options.conflicts?.[source] ?? [],
        ...(sshAuthSock ? { sshAuthSock } : {}),
      }
    }),
    close,
  })
  return Object.assign(fake, { close })
}
