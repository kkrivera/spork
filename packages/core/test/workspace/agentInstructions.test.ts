import { describe, expect, it } from 'vitest'
import { renderAgentsBody, renderClaudeBody, type RepoAgentFiles, type RepoSummary } from '../../src/workspace/agentInstructions.js'
import type { ManifestEntry, WorkspaceManifest } from '../../src/workspace/manifest.js'

const NO_FILES: RepoAgentFiles = { claudeMd: false, agentsMd: false, claudeSettings: false, claudeAgents: false }

function worktree(folder: string): ManifestEntry {
  return { folder, source: `git@github.com:acme/${folder}.git`, requestedRef: 'HEAD', localBranch: 'demo', addedAt: '' }
}

function adopted(folder: string): ManifestEntry {
  return { kind: 'adopted', folder, source: `/home/me/${folder}`, addedAt: '' }
}

function manifestOf(entries: ManifestEntry[]): WorkspaceManifest {
  return { name: 'demo', createdAt: '', worktrees: entries }
}

function summaries(entries: ManifestEntry[], files: Partial<Record<string, Partial<RepoAgentFiles>>> = {}): RepoSummary[] {
  return entries.map((entry) => ({ entry, files: { ...NO_FILES, ...files[entry.folder] } }))
}

describe('renderAgentsBody', () => {
  it('lists every repo with its source and branch, plus the ground rules', () => {
    const entries = [worktree('api'), worktree('web')]

    const body = renderAgentsBody(manifestOf(entries), summaries(entries))

    expect(body).toContain('# Workspace "demo"')
    expect(body).toContain('2 independent git repositories')
    expect(body).toContain('| `api/` | `git@github.com:acme/api.git` | branch `demo` |')
    expect(body).toContain('| `web/` | `git@github.com:acme/web.git` | branch `demo` |')
    expect(body).toContain('Run git, builds, linters, and tests from inside the folder they belong to.')
    expect(body).toContain('Commit in the repo you changed.')
    expect(body).toContain('share that branch for this workspace')
  })

  it('says how to add a repo when there are none yet', () => {
    const body = renderAgentsBody(manifestOf([]), [])

    expect(body).toContain('It has no repos yet.')
    expect(body).toContain('spork workspace add-repo <repo> --workspace demo')
    expect(body).not.toContain('| Folder |')
  })

  it("describes an adopted folder as the user's own checkout and skips the shared-branch rule when nothing is a worktree", () => {
    const entries = [adopted('legacy')]

    const body = renderAgentsBody(manifestOf(entries), summaries(entries))

    expect(body).toContain('1 independent git repository,')
    expect(body).toContain('| `legacy/` | `/home/me/legacy` | your existing checkout, left as is |')
    expect(body).not.toContain('share that branch')
  })
})

describe('renderClaudeBody', () => {
  it('only imports AGENTS.md when no repo needs anything extra', () => {
    expect(renderClaudeBody(summaries([worktree('api')], { api: { claudeMd: true } }))).toBe('@AGENTS.md')
  })

  it("imports a repo's AGENTS.md only when that repo has no CLAUDE.md", () => {
    const entries = [worktree('api'), worktree('web')]

    const body = renderClaudeBody(summaries(entries, { api: { agentsMd: true }, web: { agentsMd: true, claudeMd: true } }))

    expect(body).toContain('@api/AGENTS.md')
    expect(body).not.toContain('@web/AGENTS.md')
  })

  it('names repos whose Claude Code settings or subagents do not apply from the root', () => {
    const entries = [worktree('api'), worktree('web')]

    const body = renderClaudeBody(summaries(entries, { web: { claudeSettings: true, claudeAgents: true } }))

    expect(body).toContain('## Repo settings that do not apply from here')
    expect(body).toContain('- `web/`: `.claude/settings.json`, `.claude/agents/`')
    expect(body).not.toContain('- `api/`')
    expect(body).toContain('`cd web && claude`')
  })
})
