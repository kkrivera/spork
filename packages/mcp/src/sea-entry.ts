import { main } from './index.js'

// Dedicated entry point for the packaged binary (see tools/package-binary).
// A Node Single Executable Application has no separate "script path" —
// index.ts's `import.meta.url === file://${process.argv[1]}` guard always
// evaluates to false in that context, so this entry calls `main` directly.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
