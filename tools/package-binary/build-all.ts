#!/usr/bin/env node
import path from 'node:path'
import { buildBinary, type BuildArgs } from './build.js'

interface Target {
  platform: NodeJS.Platform
  arch: string
}

/** Every binary release-build.yml publishes — kept in sync with its own matrix. */
export const ALL_TARGETS: readonly Target[] = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'win32', arch: 'x64' },
  { platform: 'linux', arch: 'x64' },
]

interface Binary {
  name: string
  entry: string
}

const BINARIES: readonly Binary[] = [
  { name: 'spork', entry: path.join('packages', 'cli', 'src', 'sea-entry.ts') },
  { name: 'spork-mcp', entry: path.join('packages', 'mcp', 'src', 'sea-entry.ts') },
]

export function parseArgs(argv: readonly string[]): { platform?: NodeJS.Platform } {
  const index = argv.indexOf('--platform')
  return { platform: index !== -1 ? (argv[index + 1] as NodeJS.Platform | undefined) : undefined }
}

export function resolveTargets(platform?: NodeJS.Platform): readonly Target[] {
  return platform ? ALL_TARGETS.filter((target) => target.platform === platform) : ALL_TARGETS
}

/**
 * Builds every binary (`spork`, `spork-mcp`) for every target matching
 * `platformFilter` (or all four of them, unfiltered) — one real target per
 * platform/arch regardless of the host's own, using `build.ts`'s
 * `downloadNodeBinary` for anything that isn't the host's native target.
 * Sequential, not concurrent: builds share a single node-binary download
 * cache and write into per-target subfolders of `outDir`, so there's
 * nothing to parallelize safely gain from racing them.
 */
export async function buildAll(platformFilter: NodeJS.Platform | undefined, outDir = 'dist-sea'): Promise<string[]> {
  const targets = resolveTargets(platformFilter)
  if (targets.length === 0) {
    throw new Error(`No targets match platform "${platformFilter}". Expected one of darwin, win32, linux.`)
  }

  const binaryPaths: string[] = []
  for (const target of targets) {
    for (const binary of BINARIES) {
      const args: BuildArgs = {
        entry: binary.entry,
        name: binary.name,
        outDir: path.join(outDir, `${target.platform}-${target.arch}`),
        platform: target.platform,
        arch: target.arch,
      }
      binaryPaths.push(await buildBinary(args))
    }
  }
  return binaryPaths
}

export async function main(): Promise<void> {
  const { platform } = parseArgs(process.argv.slice(2))
  const paths = await buildAll(platform)
  for (const binaryPath of paths) console.log(binaryPath)
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
