import os from 'node:os'
import path from 'node:path'

/** Shortens a path under the home directory to `~/…`, for display only. */
export function tildify(file: string, home: string = os.homedir()): string {
  if (file === home) return '~'
  return file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file
}

/**
 * Where a workspace lives, for display — or `null` when it's exactly where
 * `workspace create` would have put it by default (`SPORK_WORKSPACE_DIR`
 * plus its name), since the name already says that much. Without
 * `SPORK_WORKSPACE_DIR` there's no default to compare against, so every
 * workspace gets a location.
 */
export function workspaceLocation(
  workspace: { name: string; dir: string },
  defaultParent: string | undefined,
  home?: string,
): string | null {
  if (defaultParent && path.resolve(workspace.dir) === path.resolve(defaultParent, workspace.name)) return null
  return tildify(workspace.dir, home)
}
