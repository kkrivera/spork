import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateFormula, parseArgs, renderFormula, sha256File } from '../generate-formula.js'

describe('renderFormula', () => {
  it('replaces every placeholder token', () => {
    const template =
      'version "{{VERSION}}"\n{{DARWIN_ARM64_SHA256}} {{DARWIN_X64_SHA256}} {{LINUX_X64_SHA256}}\n' +
      '{{MCP_DARWIN_ARM64_SHA256}} {{MCP_DARWIN_X64_SHA256}} {{MCP_LINUX_X64_SHA256}}'

    const result = renderFormula(template, {
      version: '1.2.3',
      darwinArm64Sha256: 'a'.repeat(64),
      darwinX64Sha256: 'b'.repeat(64),
      linuxX64Sha256: 'c'.repeat(64),
      mcpDarwinArm64Sha256: 'd'.repeat(64),
      mcpDarwinX64Sha256: 'e'.repeat(64),
      mcpLinuxX64Sha256: 'f'.repeat(64),
    })

    expect(result).toBe(
      `version "1.2.3"\n${'a'.repeat(64)} ${'b'.repeat(64)} ${'c'.repeat(64)}\n${'d'.repeat(64)} ${'e'.repeat(64)} ${'f'.repeat(64)}`,
    )
  })

  it('replaces every occurrence of a repeated token', () => {
    const result = renderFormula('{{VERSION}} and {{VERSION}} again', {
      version: '1.0.0',
      darwinArm64Sha256: '',
      darwinX64Sha256: '',
      linuxX64Sha256: '',
      mcpDarwinArm64Sha256: '',
      mcpDarwinX64Sha256: '',
      mcpLinuxX64Sha256: '',
    })

    expect(result).toBe('1.0.0 and 1.0.0 again')
  })
})

describe('parseArgs', () => {
  it('reads --version and defaults the rest', () => {
    expect(parseArgs(['--version', '1.2.3'])).toEqual({
      version: '1.2.3',
      artifactsDir: 'artifacts',
      templatePath: 'tools/homebrew-formula/spork.rb.template',
      formulaPath: 'Formula/spork.rb',
    })
  })

  it('reads explicit overrides', () => {
    expect(
      parseArgs(['--version', '1.2.3', '--artifacts-dir', 'out', '--template', 't.rb', '--formula-path', 'f.rb']),
    ).toEqual({ version: '1.2.3', artifactsDir: 'out', templatePath: 't.rb', formulaPath: 'f.rb' })
  })

  it('throws when --version is missing', () => {
    expect(() => parseArgs([])).toThrow('Usage:')
  })
})

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spork-homebrew-formula-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sha256File', () => {
  it('hashes the file\'s real contents', async () => {
    const filePath = path.join(dir, 'a.tar.gz')
    await writeFile(filePath, 'hello')

    expect(await sha256File(filePath)).toBe(createHash('sha256').update('hello').digest('hex'))
  })
})

describe('generateFormula', () => {
  it('renders the template with each archive\'s real sha256 and writes the formula', async () => {
    const artifactsDir = path.join(dir, 'artifacts')
    await mkdir(artifactsDir, { recursive: true })
    await writeFile(path.join(artifactsDir, 'spork-1.2.3-darwin-arm64.tar.gz'), 'arm64')
    await writeFile(path.join(artifactsDir, 'spork-1.2.3-darwin-x64.tar.gz'), 'x64')
    await writeFile(path.join(artifactsDir, 'spork-1.2.3-linux-x64.tar.gz'), 'linux')
    await writeFile(path.join(artifactsDir, 'spork-mcp-1.2.3-darwin-arm64.tar.gz'), 'mcp-arm64')
    await writeFile(path.join(artifactsDir, 'spork-mcp-1.2.3-darwin-x64.tar.gz'), 'mcp-x64')
    await writeFile(path.join(artifactsDir, 'spork-mcp-1.2.3-linux-x64.tar.gz'), 'mcp-linux')

    const templatePath = path.join(dir, 'template.rb')
    await writeFile(
      templatePath,
      'version "{{VERSION}}"\ndarwin-arm64 {{DARWIN_ARM64_SHA256}}\ndarwin-x64 {{DARWIN_X64_SHA256}}\nlinux-x64 {{LINUX_X64_SHA256}}\n' +
        'mcp-darwin-arm64 {{MCP_DARWIN_ARM64_SHA256}}\nmcp-darwin-x64 {{MCP_DARWIN_X64_SHA256}}\nmcp-linux-x64 {{MCP_LINUX_X64_SHA256}}\n',
    )

    const formulaPath = path.join(dir, 'Formula', 'spork.rb')
    await mkdir(path.dirname(formulaPath), { recursive: true })

    const rendered = await generateFormula({ version: '1.2.3', artifactsDir, templatePath, formulaPath })

    expect(rendered).toContain('version "1.2.3"')
    expect(rendered).toContain(createHash('sha256').update('arm64').digest('hex'))
    expect(rendered).toContain(createHash('sha256').update('x64').digest('hex'))
    expect(rendered).toContain(createHash('sha256').update('linux').digest('hex'))
    expect(rendered).toContain(`mcp-darwin-arm64 ${createHash('sha256').update('mcp-arm64').digest('hex')}`)
    expect(rendered).toContain(`mcp-darwin-x64 ${createHash('sha256').update('mcp-x64').digest('hex')}`)
    expect(rendered).toContain(`mcp-linux-x64 ${createHash('sha256').update('mcp-linux').digest('hex')}`)
    expect(await readFile(formulaPath, 'utf8')).toBe(rendered)
  })
})
