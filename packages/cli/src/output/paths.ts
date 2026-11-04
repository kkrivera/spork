import os from 'node:os'
import path from 'node:path'

/** Shortens a path under the home directory to `~/…`, for display only. */
export function tildify(file: string, home: string = os.homedir()): string {
  if (file === home) return '~'
  return file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file
}

/**
 * Where a workspace lives, for display: the folder it sits in, shortened.
 * A workspace's directory is usually `<parent>/<name>`, and the name is
 * already on screen, so only `<parent>` is shown. One whose directory
 * doesn't end in its name (`workspace init` on an existing folder) shows
 * its whole directory instead.
 */
export function workspaceLocation(workspace: { name: string; dir: string }, home?: string): string {
  const dir = path.resolve(workspace.dir)
  const suffix = `${path.sep}${path.normalize(workspace.name)}`
  const location = dir.endsWith(suffix) ? dir.slice(0, -suffix.length) || path.sep : dir
  return tildify(location, home)
}
