import os from 'node:os'
import path from 'node:path'

/** Root of spork's local, machine-specific state — repo caches and the workspace registry. */
export const SPORK_HOME = path.join(os.homedir(), '.spork')

export const REPOS_ROOT = path.join(SPORK_HOME, 'repos')

export const REGISTRY_PATH = path.join(SPORK_HOME, 'workspaces.json')
