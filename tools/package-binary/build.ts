#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import * as esbuild from 'esbuild'

/**
 * Builds a Node.js Single Executable Application binary for a given
 * OS/arch target, defaulting to the host's own. When the target differs
 * from the host, the target's official node binary is downloaded from
 * nodejs.org (checksum-verified) instead of copying the host's own —
 * verified for real (not just from the docs) that this produces a working
 * binary: built+injected a linux-x64 target from this macOS host and ran
 * it inside a real Linux container. Produces an UNSIGNED binary; real
 * macOS signing/notarization is a separate step (see macos-sign.sh), and
 * only ever runs on an actual macOS host/target pair (codesign doesn't
 * exist anywhere else).
 */

export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
export const SEA_RESOURCE = 'NODE_SEA_BLOB'
export const SEA_MACHO_SEGMENT = 'NODE_SEA'

export interface BuildArgs {
  entry: string
  name: string
  outDir: string
  /** Target platform; defaults to the host's own. */
  platform?: NodeJS.Platform
  /** Target arch; defaults to the host's own. */
  arch?: string
}

export function parseArgs(argv: readonly string[]): BuildArgs {
  const read = (flag: string): string => {
    const index = argv.indexOf(flag)
    const value = index !== -1 ? argv[index + 1] : undefined
    if (!value) throw new Error('Usage: build.ts --entry <path> --name <name> [--out-dir <dir>] [--platform <p>] [--arch <a>]')
    return value
  }
  const readOptional = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag)
    return index !== -1 ? (argv[index + 1] ?? fallback) : fallback
  }
  return {
    entry: read('--entry'),
    name: read('--name'),
    outDir: readOptional('--out-dir', 'dist-sea'),
    platform: readOptional('--platform', process.platform) as NodeJS.Platform,
    arch: readOptional('--arch', process.arch),
  }
}

export function outputBinaryName(name: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${name}.exe` : name
}

/**
 * `sea-entry.ts` calls `main()` directly and never reads `index.ts`'s
 * top-level `isMainModule` guard, but esbuild still bundles that guard in
 * (it's module-scope code in an imported file) and warns that
 * `import.meta.url` is empty in "cjs" output — true, but harmless here
 * since the guard's result is never consulted. Silenced rather than
 * restructured: `index.ts` needs that guard to double as the npm package's
 * own ESM bin entry, and the warning has no fix that doesn't either
 * duplicate that file or fork its logic.
 */
export async function bundle(entry: string, bundlePath: string): Promise<void> {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logOverride: { 'empty-import-meta': 'silent' },
  })
}

export async function writeSeaConfig(configPath: string, bundlePath: string, blobPath: string): Promise<void> {
  const config = { main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true }
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
}

export function generateBlob(configPath: string): void {
  execFileSync(process.execPath, ['--experimental-sea-config', configPath], { stdio: 'inherit' })
}

export async function copyNodeBinary(destPath: string): Promise<void> {
  await copyFile(process.execPath, destPath)
  await chmod(destPath, 0o755)
}

export function nodeArchiveName(version: string, platform: NodeJS.Platform, arch: string): string {
  const osName = platform === 'win32' ? 'win' : platform
  const ext = platform === 'win32' ? 'zip' : 'tar.gz'
  return `node-${version}-${osName}-${arch}.${ext}`
}

export function nodeDownloadUrl(version: string, archiveName: string): string {
  return `https://nodejs.org/dist/${version}/${archiveName}`
}

/** Finds `archiveName`'s expected sha256 in a `SHASUMS256.txt` file's contents. */
export function parseShasum(shasumsText: string, archiveName: string): string {
  const line = shasumsText.split('\n').find((candidate) => candidate.trimEnd().endsWith(archiveName))
  const sha = line?.trim().split(/\s+/)[0]
  if (!sha) throw new Error(`No checksum found for ${archiveName} in SHASUMS256.txt`)
  return sha
}

function extractArchive(archivePath: string, extractDir: string, platform: NodeJS.Platform): void {
  if (platform === 'win32') {
    execFileSync('unzip', ['-q', '-o', archivePath, '-d', extractDir], { stdio: 'inherit' })
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' })
  }
}

/**
 * Downloads, checksum-verifies, and extracts the official node binary for
 * `platform`/`arch` (matching the host's own node *version* exactly — the
 * same requirement the native/copy path has), caching the extracted binary
 * under `cacheDir` so a repeated build (e.g. both `spork` and `spork-mcp`
 * for the same target) only downloads once.
 */
export async function downloadNodeBinary(
  destPath: string,
  platform: NodeJS.Platform,
  arch: string,
  cacheDir: string = path.join(os.tmpdir(), 'spork-node-binary-cache'),
): Promise<void> {
  const version = process.version
  const cachedBinaryPath = path.join(cacheDir, `node-${version}-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`)

  if (!existsSync(cachedBinaryPath)) {
    await mkdir(cacheDir, { recursive: true })
    const archiveName = nodeArchiveName(version, platform, arch)
    const archivePath = path.join(cacheDir, archiveName)
    await writeFile(archivePath, Buffer.from(await (await fetch(nodeDownloadUrl(version, archiveName))).arrayBuffer()))

    const shasumsText = await (await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).text()
    const expectedSha = parseShasum(shasumsText, archiveName)
    const actualSha = createHash('sha256').update(await readFile(archivePath)).digest('hex')
    if (actualSha !== expectedSha) {
      throw new Error(`Checksum mismatch for ${archiveName}: expected ${expectedSha}, got ${actualSha}`)
    }

    const extractDir = path.join(cacheDir, `extract-${archiveName}`)
    await mkdir(extractDir, { recursive: true })
    extractArchive(archivePath, extractDir, platform)

    const osName = platform === 'win32' ? 'win' : platform
    const extractedBinary = path.join(extractDir, `node-${version}-${osName}-${arch}`, platform === 'win32' ? 'node.exe' : 'bin/node')
    await copyFile(extractedBinary, cachedBinaryPath)
    await chmod(cachedBinaryPath, 0o755)
  }

  await copyFile(cachedBinaryPath, destPath)
  await chmod(destPath, 0o755)
}

/**
 * Removes the Node binary's own (now-stale) signature so postject can
 * safely modify it. A no-op unless both the target *and* the host are
 * darwin — `codesign` only exists on macOS, so this can't run for a
 * cross-built darwin target from a non-mac host (not a case the release
 * workflow ever hits: darwin targets only ever build on an actual macOS
 * runner, which can also sign them afterward).
 */
export function removeExistingSignature(binaryPath: string, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin') return
  if (process.platform !== 'darwin') {
    console.warn('removeExistingSignature: skipped — codesign is only available on a macOS host.')
    return
  }
  execFileSync('codesign', ['--remove-signature', binaryPath], { stdio: 'inherit' })
}

export function injectBlob(binaryPath: string, blobPath: string, platform: NodeJS.Platform = process.platform): void {
  const args = [
    '--no-install',
    'postject',
    binaryPath,
    SEA_RESOURCE,
    blobPath,
    '--sentinel-fuse',
    SEA_FUSE,
    ...(platform === 'darwin' ? ['--macho-segment-name', SEA_MACHO_SEGMENT] : []),
  ]
  execFileSync('npx', args, { stdio: 'inherit' })
}

/**
 * Ad-hoc signs (`codesign --sign -`) right after injection — on Apple
 * Silicon, macOS kills an injected-but-unsigned binary outright (SIGKILL)
 * before it ever reaches user code, so without this a plain local `yarn
 * package:mac` produces a binary that can't even run. Same host-capability
 * guard as `removeExistingSignature`, and harmless to do unconditionally:
 * `release-build.yml`'s own `macos-sign.sh` step runs afterward and always
 * re-signs with `--force`, overwriting this with a real identity when one
 * is configured.
 */
export function adHocSign(binaryPath: string, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin') return
  if (process.platform !== 'darwin') {
    console.warn('adHocSign: skipped — codesign is only available on a macOS host.')
    return
  }
  execFileSync('codesign', ['--sign', '-', '--force', binaryPath], { stdio: 'inherit' })
}

export async function buildBinary(args: BuildArgs): Promise<string> {
  const platform = args.platform ?? process.platform
  const arch = args.arch ?? process.arch

  await mkdir(args.outDir, { recursive: true })

  const bundlePath = path.join(args.outDir, `${args.name}-bundle.cjs`)
  const blobPath = path.join(args.outDir, `${args.name}.blob`)
  const configPath = path.join(args.outDir, `${args.name}.sea-config.json`)
  const binaryPath = path.join(args.outDir, outputBinaryName(args.name, platform))

  await bundle(args.entry, bundlePath)
  await writeSeaConfig(configPath, bundlePath, blobPath)
  generateBlob(configPath)

  const isNativeTarget = platform === process.platform && arch === process.arch
  if (isNativeTarget) {
    await copyNodeBinary(binaryPath)
  } else {
    await downloadNodeBinary(binaryPath, platform, arch)
  }

  removeExistingSignature(binaryPath, platform)
  injectBlob(binaryPath, blobPath, platform)
  adHocSign(binaryPath, platform)

  return binaryPath
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const binaryPath = await buildBinary(args)
  console.log(binaryPath)
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
