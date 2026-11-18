import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { SporkError } from '@spork/core'
import { registerShellInitCommand, runShellInit } from '../../../src/commands/shell/shellInit.js'

describe('runShellInit', () => {
  it("prints each supported shell's function", () => {
    expect(runShellInit('zsh')).toContain('spork() {')
    expect(runShellInit('fish')).toContain('function spork')
  })

  it('names the supported shells for any other', () => {
    expect(() => runShellInit('nu')).toThrow(SporkError)
    expect(() => runShellInit('nu')).toThrow('zsh, bash, fish')
  })
})

describe('registerShellInitCommand', () => {
  it('writes the script to stdout as-is', async () => {
    const program = new Command()
    registerShellInitCommand(program)
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await program.parseAsync(['node', 'test', 'shell-init', 'bash'])

    expect(write).toHaveBeenCalledWith(runShellInit('bash'))
    write.mockRestore()
  })
})
