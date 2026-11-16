import path from 'node:path'
import { codeWorkspaceFilePath, createAndRegisterWorkspace, SporkError, type WorkspaceHandle } from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { Command } from 'commander'
import { workspaceContext, type AppContext } from '../../context.js'
import { tildify } from '../../output/paths.js'
import {
  defaultLaunchDeps,
  launchWorkspace,
  LAUNCH_TARGET_OPTIONS,
  type LaunchDeps,
  type LaunchTarget,
} from '../../launchTarget.js'
import { keyUnlockNotifier, prepareWorkspaceRemotes, type RemoteSetupOptions } from './workspaceRemotes.js'
import { addReposToWorkspace, type AddRepoBatchOutcome } from './addReposBatch.js'
import { printAddRepoResult } from './addRepo.js'
import {
  createFromPushedBranch,
  pickRepos,
  type CreateReporter,
  type CreateWithReposResult,
} from './createFromPushedBranch.js'
import { isInteractiveTerminal } from '../repo/add.js'
import { runList, type ScopedRepoEntry } from '../repo/list.js'

export interface CreateOptions extends RemoteSetupOptions {
  dir?: string
  repo?: string[]
  /** Register each --repo's alias globally instead of locally to the new workspace (the default). */
  global?: boolean
  /** `false` from `--no-agent-files`: skip the generated root AGENTS.md/CLAUDE.md for this workspace. */
  agentFiles?: boolean
}

function collectRepo(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/**
 * `--dir` names a *parent* directory, not the exact target — the workspace
 * always lands at `<parent>/<name>` (parent defaults to `$SPORK_WORKSPACE_DIR`,
 * then cwd), never at `--dir` verbatim. This guarantees the folder's
 * basename always matches `name`, which is also every worktree's branch
 * name verbatim (shared by every repo in the workspace — see `addRepo`) —
 * letting them diverge would mean a workspace whose folder and branch
 * disagree about what it's even called.
 */
export async function runCreate(ctx: AppContext, name: string, options: CreateOptions): Promise<WorkspaceHandle> {
  const dir = workspaceDirFor(ctx, name, options)
  const agentInstructions = options.agentFiles === false ? { agentInstructions: false } : {}
  return createAndRegisterWorkspace(workspaceContext(ctx), ctx.registryPath, { name, dir, ...agentInstructions })
}

function workspaceDirFor(ctx: AppContext, name: string, options: CreateOptions): string {
  return path.resolve(options.dir ?? ctx.env.workspaceDir ?? process.cwd(), name)
}

/**
 * The repos to add when `create` won't check the registry's remotes
 * first (see `runCreateWithRepos`): an explicit `--repo` wins outright;
 * otherwise a multi-select of known repos, when there are any. A terminal
 * that can't show one (CI, a pipe, a script) means none, creating an
 * empty workspace. A real cancel (Esc/Ctrl+C) means the user started
 * picking and backed out, so that becomes a `SporkError`, same as every
 * other cancelled-prompt path in this CLI.
 */
async function resolveRepoSources(name: string, options: CreateOptions, candidates: readonly ScopedRepoEntry[]): Promise<string[]> {
  if (options.repo && options.repo.length > 0) return options.repo
  if (candidates.length === 0) return []

  let chosen: string[] | null
  try {
    chosen = await pickRepos(`Select repos to add to "${name}"`, candidates)
  } catch (error) {
    if (error instanceof NotInteractiveError) return []
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen
}

/**
 * Creates the workspace and adds its repos, settling everything with the
 * remotes (`workspaceRemotes.ts`: unlocking an SSH key, branch-name
 * clashes, starting from an already-pushed workspace branch) *before*
 * creating anything, so backing out of a question leaves no half-made
 * workspace behind. At a terminal with no `--repo` and no
 * `--[no-]from-remote-branch`, `createFromPushedBranch.ts` checks every
 * registered repo for the workspace's branch first and offers those that
 * have it. Otherwise the repos are `--repo`, or a pick (`resolveRepoSources`).
 *
 * Adds go through `addReposBatch.ts`, best-effort: every repo runs
 * regardless of a sibling's failure, so the workspace ends up with
 * whichever succeeded. `reporter` hears about each step as it happens;
 * `registerCreateCommand` throws afterwards if any add failed, to keep
 * the process exiting non-zero.
 */
export async function runCreateWithRepos(
  ctx: AppContext,
  name: string,
  options: CreateOptions,
  reporter: CreateReporter = {},
): Promise<CreateWithReposResult> {
  const dir = workspaceDirFor(ctx, name, options)
  const explicit = options.repo !== undefined && options.repo.length > 0
  const candidates = explicit ? [] : await runList(ctx)
  const create = async (): Promise<WorkspaceHandle> => runCreate(ctx, name, options)
  if (candidates.length > 0 && options.fromRemoteBranch === undefined && isInteractiveTerminal()) {
    return createFromPushedBranch({ ctx, name, dir, options, create, reporter }, candidates)
  }

  const sources = await resolveRepoSources(name, options, candidates)
  const remotes = await prepareWorkspaceRemotes(ctx, dir, name, sources, options)
  try {
    const handle = await create()
    reporter.created?.(handle)
    const repoOutcomes = await addReposToWorkspace(ctx, handle.dir, sources, {
      global: options.global,
      fetchRemoteBranchFrom: remotes.fetchRemoteBranchFrom,
      sshAuthSocks: remotes.sshAuthSocks,
    })
    reporter.reposAdded?.(repoOutcomes, remotes.remoteBranchNotice)
    return { handle, repoOutcomes }
  } finally {
    await remotes.close()
  }
}

type OfferChoice = LaunchTarget | 'skip'

const OFFER_OPTIONS: PromptOption<OfferChoice>[] = [...LAUNCH_TARGET_OPTIONS, { label: 'Not now', value: 'skip' }]

/**
 * Offers to launch the freshly-created workspace — the user is likely
 * creating one to start working in it right away. A 3-way pick (VS Code /
 * Claude / not now) rather than a yes/no confirm, since there are now two
 * real ways to open it. Skipped silently (not an error) both when `select`
 * can't prompt (`NotInteractiveError`: CI, a pipe, a script) and when the
 * user explicitly backs out (Esc) or picks "Not now" — this offer is
 * optional by construction, unlike `open`'s own mandatory pick, so neither
 * outcome is treated as a cancelled-prompt error the way other pickers do.
 */
async function offerToLaunchWorkspace(ctx: AppContext, handle: WorkspaceHandle, deps: LaunchDeps): Promise<void> {
  let chosen: OfferChoice[] | null
  try {
    chosen = await select({ message: `Open "${handle.name}" now?`, options: OFFER_OPTIONS, mode: 'single' })
  } catch (error) {
    if (error instanceof NotInteractiveError) return
    throw error
  }

  const target = chosen?.[0]
  if (!target || target === 'skip') {
    console.log(`Open later with: spork workspace open ${handle.name}`)
    return
  }

  const filePath = codeWorkspaceFilePath(handle.dir, handle.name)
  const outcome = await launchWorkspace(target, handle.dir, filePath, deps)
  if (target === 'code') {
    if (outcome.ok) {
      console.log(ctx.ui.color.green(`Opened ${tildify(filePath)}`))
    } else {
      console.log(`Couldn't launch the "code" CLI (${outcome.reason}). Open manually: ${tildify(filePath)}`)
    }
  } else if (!outcome.ok) {
    console.log(`Couldn't launch Claude (${outcome.reason}). Run it yourself: cd ${tildify(handle.dir)} && claude`)
  }
}

export function registerCreateCommand(program: Command, ctx: AppContext, deps: LaunchDeps = defaultLaunchDeps()): void {
  program
    .command('create <name>')
    .description('Create a new workspace')
    .option('--dir <path>', 'parent directory to create the workspace in, as <path>/<name> (default: $SPORK_WORKSPACE_DIR, or cwd)')
    .option('--repo <source>', 'repo to add (repeatable)', collectRepo, [] as string[])
    .option('--global', "register each --repo's alias globally instead of locally to this workspace")
    .option('--no-agent-files', "don't generate AGENTS.md/CLAUDE.md at the workspace root")
    .option('--from-remote-branch', "start from this workspace's branch on the remote if it's already been pushed (default: ask)")
    .option('--no-from-remote-branch', "start fresh even if this workspace's branch is already on the remote, without asking")
    .action(async (name: string, options: CreateOptions) => {
      const { handle, repoOutcomes } = await runCreateWithRepos(
        ctx,
        name,
        { ...options, onUnlockKey: keyUnlockNotifier(ctx) },
        createReporter(ctx, name),
      )
      if (repoOutcomes.length === 0) console.log(`Add a repo with: spork workspace add-repo ${handle.name} <repo>`)

      await offerToLaunchWorkspace(ctx, handle, deps)

      const failures = repoOutcomes.filter((outcome) => outcome.failure)
      if (failures.length > 0) {
        throw new SporkError(`${failures.length} of ${repoOutcomes.length} repo adds did not succeed: ${failures.map((f) => f.source).join(', ')}`)
      }
    })
}

/** Prints each step of `runCreateWithRepos` as it happens. */
function createReporter(ctx: AppContext, name: string): CreateReporter {
  return {
    checkingRemotes: (count) =>
      console.log(ctx.ui.color.dim(`Checking ${count} registered ${count === 1 ? 'repo' : 'repos'} for a "${name}" branch...`)),
    created: (handle) => console.log(ctx.ui.color.green(`Created workspace "${handle.name}" at ${tildify(handle.dir)}`)),
    reposAdded: (outcomes: AddRepoBatchOutcome[], notice) => {
      if (notice) console.log(ctx.ui.color.dim(notice))
      for (const outcome of outcomes) {
        if (outcome.result) printAddRepoResult(ctx, name, outcome.result)
        else if (outcome.failure) console.log(ctx.ui.color.red(`Failed to add "${outcome.source}": ${outcome.failure.reason}`))
      }
    },
  }
}
