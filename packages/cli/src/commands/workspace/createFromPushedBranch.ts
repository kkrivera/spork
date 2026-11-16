import { defaultAlias, repoOwner, SporkError, type RemoteAccessSession, type WorkspaceHandle } from '@spork/core'
import { confirm, NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { AppContext } from '../../context.js'
import type { ScopedRepoEntry } from '../repo/list.js'
import { addReposToWorkspace, type AddRepoBatchOutcome } from './addReposBatch.js'
import { checkRemotes, planRemotes, type RemotePlan, type RemoteSetupOptions } from './workspaceRemotes.js'

/**
 * How `runCreateWithRepos` reports progress as it goes, for
 * `registerCreateCommand` to print — it can't wait until the end, since
 * `create` may ask more questions after the first repos are added.
 */
export interface CreateReporter {
  /** Right before checking every registered repo's remote for the workspace's branch. */
  checkingRemotes?(count: number): void
  created?(handle: WorkspaceHandle): void
  /** After each batch of adds; `notice` is `RemotePlan.remoteBranchNotice`. */
  reposAdded?(outcomes: AddRepoBatchOutcome[], notice?: string): void
}

export interface CreateWithReposResult {
  handle: WorkspaceHandle
  /** Every add, across every batch. */
  repoOutcomes: AddRepoBatchOutcome[]
}

export interface CreateFlow {
  ctx: AppContext
  name: string
  /** Where the workspace will be created, for resolving aliases before it exists. */
  dir: string
  options: RemoteSetupOptions & { global?: boolean }
  /** Creates and registers the (still empty) workspace. */
  create(): Promise<WorkspaceHandle>
  reporter: CreateReporter
}

/** The multi-select of registered repos `create` offers. Null when the user backs out (Esc). */
export async function pickRepos(message: string, candidates: readonly ScopedRepoEntry[]): Promise<string[] | null> {
  const options: PromptOption<string>[] = candidates.map((repo) => ({
    label: repo.alias,
    value: repo.source,
    hint: `${repo.source} (${repo.scope})`,
  }))
  return select({ message, options, mode: 'multi' })
}

/**
 * `create`'s interactive flow when no `--repo` is given: checks every
 * registered repo's remote for a branch named after the workspace first,
 * rather than only the ones picked. If some have it, offers to create the
 * workspace with exactly those, each starting from its remote branch,
 * then asks whether to add more (from the rest of the registry, starting
 * fresh). Declining the offer, or no repo having the branch, falls back to
 * the usual pick-then-create. Everything is planned from that one check,
 * so no remote is asked twice and an unlocked SSH key is kept for every
 * add, then forgotten.
 */
export async function createFromPushedBranch(
  flow: CreateFlow,
  candidates: readonly ScopedRepoEntry[],
): Promise<CreateWithReposResult> {
  flow.reporter.checkingRemotes?.(candidates.length)
  const session = await checkRemotes(flow.ctx, flow.dir, flow.name, candidates.map((repo) => repo.source), flow.options)
  try {
    const pushed = pushedSources(session)
    if (pushed.length > 0 && (await offerPushedRepos(flow.name, pushed))) {
      return await createWithPushedRepos(flow, session, pushed, candidates)
    }
    const chosen = await pickRepos(`Select repos to add to "${flow.name}"`, candidates)
    if (chosen === null) throw new SporkError('Cancelled.')
    const plan = await planRemotes(session, flow.name, chosen, flow.options.fromRemoteBranch)
    const handle = await flow.create()
    flow.reporter.created?.(handle)
    return { handle, repoOutcomes: await addBatch(flow, handle, chosen, plan) }
  } finally {
    await session.close()
  }
}

/** Repos whose remote already has the workspace's branch, and nothing in the way of checking it out. */
function pushedSources(session: RemoteAccessSession): string[] {
  return session.repos.filter((repo) => repo.hasBranch && repo.conflicts.length === 0).map((repo) => repo.source)
}

/** "Create the workspace with those 2 repos?" Esc, or a terminal that can't ask, means no. */
async function offerPushedRepos(branch: string, pushed: readonly string[]): Promise<boolean> {
  const where = listInWords(pushed.map(ownerAndRepo))
  const those = pushed.length === 1 ? 'that repo' : `those ${pushed.length} repos`
  return askYesNo(`Branch "${branch}" already exists on ${where}. Create the workspace with ${those}?`)
}

/** `acme/app` for a hosted repo, or just `app` when its source has no owner (a local path). */
function ownerAndRepo(source: string): string {
  const owner = repoOwner(source)
  return owner ? `${owner}/${defaultAlias(source)}` : defaultAlias(source)
}

async function createWithPushedRepos(
  flow: CreateFlow,
  session: RemoteAccessSession,
  pushed: string[],
  candidates: readonly ScopedRepoEntry[],
): Promise<CreateWithReposResult> {
  const plan = await planRemotes(session, flow.name, pushed, true)
  const handle = await flow.create()
  flow.reporter.created?.(handle)
  const repoOutcomes = await addBatch(flow, handle, pushed, plan)

  const rest = candidates.filter((repo) => !pushed.includes(repo.source))
  if (rest.length === 0 || !(await askYesNo(`Add more repos to "${flow.name}"?`))) return { handle, repoOutcomes }
  const more = (await pickRepos(`Select more repos to add to "${flow.name}"`, rest)) ?? []
  if (more.length === 0) return { handle, repoOutcomes }

  const morePlan = await planRemotes(session, flow.name, more, false)
  return { handle, repoOutcomes: [...repoOutcomes, ...(await addBatch(flow, handle, more, morePlan))] }
}

async function addBatch(
  flow: CreateFlow,
  handle: WorkspaceHandle,
  sources: string[],
  plan: RemotePlan,
): Promise<AddRepoBatchOutcome[]> {
  const outcomes = await addReposToWorkspace(flow.ctx, handle.dir, sources, {
    global: flow.options.global,
    fetchRemoteBranchFrom: plan.fetchRemoteBranchFrom,
    sshAuthSocks: plan.sshAuthSocks,
  })
  flow.reporter.reposAdded?.(outcomes, plan.remoteBranchNotice)
  return outcomes
}

async function askYesNo(message: string): Promise<boolean> {
  try {
    return await confirm({ message })
  } catch (error) {
    if (error instanceof NotInteractiveError) return false
    throw error
  }
}

/** "a", "a and b", "a, b and c". */
export function listInWords(items: readonly string[]): string {
  if (items.length <= 2) return items.join(' and ')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
