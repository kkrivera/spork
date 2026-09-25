import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { registerRepoCommands } from '../../src/commands/repo/index.js'
import { createUi } from '../../src/output/color.js'

describe('registerRepoCommands', () => {
  it('registers a "repo" command with add/list/remove subcommands', () => {
    const program = new Command()
    const ctx = {
      reposRoot: '/repos',
      registryPath: '/workspaces.json',
      repoRegistryPath: '/repos.json',
      ui: createUi({ argv: ['--no-color'] }),
    }

    registerRepoCommands(program, ctx)

    const repo = program.commands.find((cmd) => cmd.name() === 'repo')
    expect(repo).toBeDefined()
    expect(repo?.commands.map((cmd) => cmd.name())).toEqual(expect.arrayContaining(['add', 'list', 'remove']))
  })
})
