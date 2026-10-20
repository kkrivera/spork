#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { copyFile, chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'

/**
 * Builds a Node.js Single Executable Application binary for the *current*
 * OS/arch only — the release workflow runs this natively on each target
 * runner rather than cross-compiling, which sidesteps SEA's main
 * limitation (the node binary a blob is injected into must match the one
 * it was generated against). Produces an UNSIGNED binary; real macOS
 * signing/notarization is a separate step (see macos-sign.sh).
 */

export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
export const SEA_RESOURCE = 'NODE_SEA_BLOB'
export const SEA_MACHO_SEGMENT = 'NODE_SEA'

export interface BuildArgs {
  entry: string
  name: string
  outDir: string
}

export function parseArgs(argv: readonly string[]): BuildArgs {
  const read = (flag: string): string => {
    const index = argv.indexOf(flag)
    const value = index !== -1 ? argv[index + 1] : undefined
    if (!value) throw new Error('Usage: build.ts --entry <path> --name <name> [--out-dir <dir>]')
    return value
  }
  const outIndex = argv.indexOf('--out-dir')
  const outDir = outIndex !== -1 ? argv[outIndex + 1] : 'dist-sea'
  return { entry: read('--entry'), name: read('--name'), outDir: outDir ?? 'dist-sea' }
}

export function outputBinaryName(name: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${name}.exe` : name
}

export async function bundle(entry: string, bundlePath: string): Promise<void> {
  await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundlePath })
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

/** Removes the Node binary's own (now-stale) signature so postject can safely modify it; macOS only. */
export function removeExistingSignature(binaryPath: string, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin') return
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

export async function buildBinary(args: BuildArgs): Promise<string> {
  await mkdir(args.outDir, { recursive: true })

  const bundlePath = path.join(args.outDir, `${args.name}-bundle.cjs`)
  const blobPath = path.join(args.outDir, `${args.name}.blob`)
  const configPath = path.join(args.outDir, `${args.name}.sea-config.json`)
  const binaryPath = path.join(args.outDir, outputBinaryName(args.name))

  await bundle(args.entry, bundlePath)
  await writeSeaConfig(configPath, bundlePath, blobPath)
  generateBlob(configPath)
  await copyNodeBinary(binaryPath)
  removeExistingSignature(binaryPath)
  injectBlob(binaryPath, blobPath)

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
