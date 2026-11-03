import { execGit, GitCommandError } from './exec.js'

/**
 * Whether git can't have both branches at once. Branch names are paths
 * under `refs/heads`, so a name can't also be a folder of other branches:
 * `test` clashes with `test/a`, and `kris/test` clashes with `kris`. Two
 * names that merely share a prefix (`test`, `testing`) are fine.
 */
export function branchesConflict(branch: string, other: string): boolean {
  return other.startsWith(`${branch}/`) || branch.startsWith(`${other}/`)
}

/**
 * The `ls-remote` patterns that find every remote branch clashing with
 * `branch`: each of its parent paths exactly, and anything under it.
 * `ls-remote` matches patterns against the tail of a ref, so callers still
 * filter the results with `branchesConflict`.
 */
export function branchConflictPatterns(branch: string): string[] {
  return [...parentPaths(branch).map((parent) => `refs/heads/${parent}`), `refs/heads/${branch}/*`]
}

/**
 * The local branches in `bareRepoPath` that clash with `branch`. A cache
 * from `git clone --bare` holds a local copy of every branch the remote
 * had at clone time, so this can find a clash the remote no longer has.
 */
export async function findLocalBranchConflicts(bareRepoPath: string, branch: string): Promise<string[]> {
  // for-each-ref matches a pattern "from the beginning up to a slash", so
  // refs/heads/test finds test/a but not testing.
  const patterns = [...parentPaths(branch), branch].map((name) => `refs/heads/${name}`)
  const { stdout } = await execGit(['for-each-ref', '--format=%(refname:strip=2)', ...patterns], { cwd: bareRepoPath })
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name !== '' && branchesConflict(branch, name))
}

const CONFLICT_ERROR = /'refs\/heads\/([^']+)' exists; cannot create 'refs\/heads\//

/** The clashing branch, if `error` is git refusing to create a branch because of one (see `branchesConflict`); otherwise null. */
export function conflictingBranchIn(error: unknown): string | null {
  if (!(error instanceof GitCommandError)) return null
  return CONFLICT_ERROR.exec(error.stderr)?.[1] ?? null
}

/** `a/b/c` → `['a', 'a/b']`. */
function parentPaths(branch: string): string[] {
  const parts = branch.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}
