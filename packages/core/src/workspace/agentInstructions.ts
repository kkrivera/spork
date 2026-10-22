import type { ManifestEntry, WorkspaceManifest } from './manifest.js'

/** Which agent-instruction and Claude Code config files a repo folder has, checked on disk at render time. */
export interface RepoAgentFiles {
  claudeMd: boolean
  agentsMd: boolean
  /** `.claude/settings.json`: hooks, permissions, env. Only applies in a session started inside the repo. */
  claudeSettings: boolean
  /** `.claude/agents/`: subagent definitions. Only discovered in a session started inside the repo. */
  claudeAgents: boolean
}

export interface RepoSummary {
  entry: ManifestEntry
  files: RepoAgentFiles
}

function checkoutLabel(entry: ManifestEntry): string {
  return entry.kind === 'adopted' ? 'your existing checkout, left as is' : `branch \`${entry.localBranch}\``
}

function repoTable(repos: readonly RepoSummary[]): string[] {
  return [
    '| Folder | Source | Checkout |',
    '| --- | --- | --- |',
    ...repos.map(({ entry }) => `| \`${entry.folder}/\` | \`${entry.source}\` | ${checkoutLabel(entry)} |`),
  ]
}

function rules(manifest: WorkspaceManifest): string[] {
  const hasWorktrees = manifest.worktrees.some((entry) => entry.kind !== 'adopted')
  return [
    '## Rules for working here',
    '',
    '- Each folder is its own git repository with its own history. Run git, builds, linters, and tests from inside the folder they belong to.',
    "- Before changing a repo, read and follow that repo's own instructions (its `CLAUDE.md`, `AGENTS.md`, or `CONTRIBUTING.md`).",
    '- Commit in the repo you changed. A change that spans several repos is one commit in each of them.',
    ...(hasWorktrees
      ? [`- Repos checked out on branch \`${manifest.name}\` share that branch for this workspace. Stay on it rather than switching branches.`]
      : []),
    '- Add or remove repos with `spork workspace add-repo` and `spork workspace remove-repo`. Don\'t hand-edit `spork.workspace.json`, the `.code-workspace` file, or the spork-generated parts of `AGENTS.md` and `CLAUDE.md`.',
  ]
}

/**
 * The tool-neutral content of the workspace root's `AGENTS.md`: what this
 * folder is, which repos are in it, and the ground rules for working
 * across them.
 */
export function renderAgentsBody(manifest: WorkspaceManifest, repos: readonly RepoSummary[]): string {
  const intro =
    repos.length === 0
      ? [`This folder is a spork workspace. It has no repos yet. Add one with \`spork workspace add-repo <repo> --workspace ${manifest.name}\`.`]
      : [
          `This folder is a spork workspace: ${repos.length} independent git ${repos.length === 1 ? 'repository' : 'repositories'}, each in its own folder. The workspace folder itself is not a git repository.`,
          '',
          ...repoTable(repos),
        ]
  return [`# Workspace "${manifest.name}"`, '', ...intro, '', ...rules(manifest)].join('\n')
}

function unappliedConfig(files: RepoAgentFiles): string[] {
  return [...(files.claudeSettings ? ['`.claude/settings.json`'] : []), ...(files.claudeAgents ? ['`.claude/agents/`'] : [])]
}

/**
 * The Claude-specific content of the workspace root's `CLAUDE.md`. Imports
 * `AGENTS.md` (Claude Code only reads a root `AGENTS.md` on its own when no
 * `CLAUDE.md` exists), plus each repo's `AGENTS.md` when that repo has no
 * `CLAUDE.md` for Claude Code to load lazily. Repos' own `CLAUDE.md` files
 * are left to that lazy loading rather than imported, so their context is
 * only spent on repos a task actually touches. Also names every repo whose
 * Claude Code settings or subagents don't apply from the workspace root.
 */
export function renderClaudeBody(repos: readonly RepoSummary[]): string {
  const agentsOnly = repos.filter(({ files }) => files.agentsMd && !files.claudeMd)
  const withConfig = repos.filter(({ files }) => unappliedConfig(files).length > 0)
  const lines = ['@AGENTS.md']

  if (agentsOnly.length > 0) {
    lines.push('', "These repos' instructions only exist as `AGENTS.md`, so they're imported here:", '')
    lines.push(...agentsOnly.map(({ entry }) => `@${entry.folder}/AGENTS.md`))
  }

  if (withConfig.length > 0) {
    lines.push(
      '',
      '## Repo settings that do not apply from here',
      '',
      'These repos have Claude Code settings (hooks, permissions) or subagents that only take effect in a session started inside the repo:',
      '',
      ...withConfig.map(({ entry, files }) => `- \`${entry.folder}/\`: ${unappliedConfig(files).join(', ')}`),
      '',
      `When working in one of them, run its checks (formatters, linters, tests) from inside its folder yourself, since its hooks won't run them. For larger changes, suggest starting a session there, for example \`cd ${withConfig[0]?.entry.folder ?? ''} && claude\`.`,
    )
  }

  return lines.join('\n')
}
