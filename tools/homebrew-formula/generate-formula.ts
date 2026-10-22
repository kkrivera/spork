#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface FormulaValues {
  version: string
  darwinArm64Sha256: string
  darwinX64Sha256: string
  linuxX64Sha256: string
  mcpDarwinArm64Sha256: string
  mcpDarwinX64Sha256: string
  mcpLinuxX64Sha256: string
}

const PLACEHOLDERS: Record<keyof FormulaValues, string> = {
  version: '{{VERSION}}',
  darwinArm64Sha256: '{{DARWIN_ARM64_SHA256}}',
  darwinX64Sha256: '{{DARWIN_X64_SHA256}}',
  linuxX64Sha256: '{{LINUX_X64_SHA256}}',
  mcpDarwinArm64Sha256: '{{MCP_DARWIN_ARM64_SHA256}}',
  mcpDarwinX64Sha256: '{{MCP_DARWIN_X64_SHA256}}',
  mcpLinuxX64Sha256: '{{MCP_LINUX_X64_SHA256}}',
}

/** Full-text substitution, not an in-place patch — every run re-renders the whole file from the template, so it's idempotent regardless of what the previous release's values were. */
export function renderFormula(template: string, values: FormulaValues): string {
  return (Object.keys(PLACEHOLDERS) as (keyof FormulaValues)[]).reduce(
    (text, key) => text.replaceAll(PLACEHOLDERS[key], values[key]),
    template,
  )
}

export async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

export interface Args {
  version: string
  artifactsDir: string
  templatePath: string
  formulaPath: string
}

function readOption(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index !== -1 ? argv[index + 1] : undefined
}

export function parseArgs(argv: readonly string[]): Args {
  const version = readOption(argv, '--version')
  if (!version) throw new Error('Usage: generate-formula.ts --version <x.y.z> [--artifacts-dir <dir>] [--template <path>] [--formula-path <path>]')

  return {
    version,
    artifactsDir: readOption(argv, '--artifacts-dir') ?? 'artifacts',
    templatePath: readOption(argv, '--template') ?? 'tools/homebrew-formula/spork.rb.template',
    formulaPath: readOption(argv, '--formula-path') ?? 'Formula/spork.rb',
  }
}

function archivePath(artifactsDir: string, binary: 'spork' | 'spork-mcp', version: string, target: string): string {
  return path.join(artifactsDir, `${binary}-${version}-${target}.tar.gz`)
}

/**
 * Regenerates `Formula/spork.rb` from the template for one release's
 * `spork` and `spork-mcp` archives — the `*-darwin-arm64`/`*-darwin-x64`/
 * `*-linux-x64` tarballs of each that `release-build.yml` already publishes
 * (the same files `gh release create` attaches). `spork` is the formula's
 * main download; `spork-mcp` is a `resource` installed alongside it. Each archive's
 * real sha256 is computed locally rather than trusted from anywhere else,
 * since that's exactly what Homebrew itself re-verifies on install.
 */
export async function generateFormula(args: Args): Promise<string> {
  const hash = (binary: 'spork' | 'spork-mcp', target: string): Promise<string> =>
    sha256File(archivePath(args.artifactsDir, binary, args.version, target))
  const [darwinArm64Sha256, darwinX64Sha256, linuxX64Sha256, mcpDarwinArm64Sha256, mcpDarwinX64Sha256, mcpLinuxX64Sha256] =
    await Promise.all([
      hash('spork', 'darwin-arm64'),
      hash('spork', 'darwin-x64'),
      hash('spork', 'linux-x64'),
      hash('spork-mcp', 'darwin-arm64'),
      hash('spork-mcp', 'darwin-x64'),
      hash('spork-mcp', 'linux-x64'),
    ])

  const template = await readFile(args.templatePath, 'utf8')
  const rendered = renderFormula(template, {
    version: args.version,
    darwinArm64Sha256,
    darwinX64Sha256,
    linuxX64Sha256,
    mcpDarwinArm64Sha256,
    mcpDarwinX64Sha256,
    mcpLinuxX64Sha256,
  })
  await writeFile(args.formulaPath, rendered, 'utf8')
  return rendered
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  await generateFormula(args)
  console.log(`Updated ${args.formulaPath} for v${args.version}`)
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
