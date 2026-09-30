export { SporkError } from './errors.js'

export type { WorkspaceManifest, WorktreeEntry } from './workspace/manifest.js'
export { MANIFEST_FILENAME, manifestPath, findEnclosingWorkspaceDir } from './workspace/manifest.js'

export type { CodeWorkspaceFile, CodeWorkspaceFolder } from './workspace/codeWorkspace.js'
export { codeWorkspaceFilePath } from './workspace/codeWorkspace.js'

export type {
  WorkspaceContext,
  WorkspaceHandle,
  CreateWorkspaceOptions,
  AddRepoOptions,
  AddRepoResult,
  RemoveWorkspaceOptions,
  ReconcileResult,
  WorktreeStatusEntry,
} from './workspace/workspace.js'
export {
  createWorkspace,
  addRepo,
  removeRepo,
  removeWorkspace,
  reconcileWorkspace,
  getWorkspaceStatus,
} from './workspace/workspace.js'

export type { WorktreeStatus } from './git/status.js'

export type { RegistryEntry } from './registry/registry.js'
export {
  registerWorkspace,
  unregisterWorkspace,
  listWorkspaces,
  resolveWorkspaceDir,
} from './registry/registry.js'

export type { RepoRegistryEntry } from './registry/repoRegistry.js'
export {
  registerRepoAlias,
  unregisterRepoAlias,
  listRepoAliases,
  resolveRepoAlias,
  resolveScopedRepoAlias,
  localRepoRegistryPath,
  LOCAL_REPO_REGISTRY_FILENAME,
} from './registry/repoRegistry.js'

export type {
  RepoContext,
  AddRepoSourceOptions,
  RemoveRepoSourceContext,
  RepoUsage,
} from './repo/repos.js'
export {
  defaultAlias,
  addRepoSource,
  addRepoSourceOrAlias,
  findRepoUsages,
  removeRepoSource,
  removeLocalRepoAlias,
} from './repo/repos.js'

export type { ScanSkip, ScanResult } from './repo/scan.js'
export { findGitRepoDirs, scanAndAddRepos } from './repo/scan.js'

export { REPOS_ROOT, REGISTRY_PATH, REPO_REGISTRY_PATH, SPORK_HOME } from './config/paths.js'
