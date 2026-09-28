import path from 'node:path'
import { findEnclosingWorkspaceDir, localRepoRegistryPath, SporkError } from '@spork/core'
import type { CoreContext } from './context.js'

export interface RepoScopeOptions {
  global?: boolean
  local?: boolean
}

export interface ResolvedRepoScope {
  scope: 'local' | 'global'
  registryPath: string
  /** Only set when scope is 'local'. */
  workspaceDir?: string
}

/**
 * Decides which repo-alias registry a standalone `repo` command should use:
 * `--global`/`--local` are explicit overrides; with neither, the default is
 * context-sensitive — local if `cwd` is inside a workspace (walking up, like
 * git's `.git` walk), global otherwise, since there's nothing to be local to
 * outside one. `workspace` commands never call this — they already know
 * their target by name, so there's no ambiguity to resolve.
 */
export function resolveRepoScope(ctx: CoreContext, options: RepoScopeOptions, cwd: string = process.cwd()): ResolvedRepoScope {
  if (options.global && options.local) {
    throw new SporkError('Pass either --global or --local, not both.')
  }

  if (options.global) {
    return { scope: 'global', registryPath: ctx.repoRegistryPath }
  }

  const workspaceDir = findEnclosingWorkspaceDir(cwd)

  if (options.local) {
    if (!workspaceDir) {
      throw new SporkError('Not inside a workspace — pass --global, or run this from inside one.')
    }
    return { scope: 'local', registryPath: localRepoRegistryPath(workspaceDir), workspaceDir }
  }

  if (workspaceDir) {
    return { scope: 'local', registryPath: localRepoRegistryPath(workspaceDir), workspaceDir }
  }
  return { scope: 'global', registryPath: ctx.repoRegistryPath }
}

/** A short, human-readable label for a resolved scope, for confirmation messages. */
export function describeRepoScope(scope: ResolvedRepoScope): string {
  return scope.scope === 'local' ? `local to "${path.basename(scope.workspaceDir as string)}"` : 'global'
}
