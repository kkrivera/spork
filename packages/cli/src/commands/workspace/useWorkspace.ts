import { markWorkspaceUsed, resolveWorkspaceDir } from '@spork/core'
import type { AppContext } from '../../context.js'

/**
 * `resolveWorkspaceDir`, plus recording the workspace as just used so the
 * pickers list it first (`listWorkspacesByRecentUse`). For a command that
 * works *in* a workspace (`open`, `exec`, `status`, `path`, `add-repo`,
 * `remove-repo`). Failing to record it never fails the command: the order
 * of a picker isn't worth an error.
 */
export async function resolveUsedWorkspaceDir(ctx: AppContext, nameOrPath: string): Promise<string> {
  const dir = await resolveWorkspaceDir(ctx.registryPath, nameOrPath)
  try {
    await markWorkspaceUsed(ctx.registryPath, dir)
  } catch {
    // Best effort, see above.
  }
  return dir
}
