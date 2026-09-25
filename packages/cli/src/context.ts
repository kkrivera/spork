import {
  REGISTRY_PATH,
  REPO_REGISTRY_PATH,
  REPOS_ROOT,
  type RemoveRepoSourceContext,
  type RepoContext,
  type WorkspaceContext,
} from '@spork/core'
import { createUi, type Ui, type UiOptions } from './output/color.js'

export interface CoreContext {
  reposRoot: string
  /** The *workspace* registry (`~/.spork/workspaces.json`). */
  registryPath: string
  /** The *repo alias* registry (`~/.spork/repos.json`). */
  repoRegistryPath: string
}

export interface AppContext extends CoreContext {
  ui: Ui
}

export function createAppContext(uiOptions?: UiOptions): AppContext {
  return {
    reposRoot: REPOS_ROOT,
    registryPath: REGISTRY_PATH,
    repoRegistryPath: REPO_REGISTRY_PATH,
    ui: createUi(uiOptions),
  }
}

/** The subset of a CoreContext that @spork/core's workspace functions need. */
export function workspaceContext(ctx: CoreContext): WorkspaceContext {
  return { reposRoot: ctx.reposRoot, repoRegistryPath: ctx.repoRegistryPath }
}

/** The subset of a CoreContext that @spork/core's repo functions (addRepoSource*) need. */
export function repoContext(ctx: CoreContext): RepoContext {
  return { reposRoot: ctx.reposRoot, repoRegistryPath: ctx.repoRegistryPath }
}

/** Same as repoContext, plus the workspace registry path removeRepoSource needs for its in-use check. */
export function removeRepoSourceContext(ctx: CoreContext): RemoveRepoSourceContext {
  return { ...repoContext(ctx), workspaceRegistryPath: ctx.registryPath }
}
