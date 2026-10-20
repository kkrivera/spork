# 0002 — Standalone binary releases

Status: Accepted

## Problem

Until now, running `spork`/`spork-mcp` has meant cloning the repo and running
through Node (`yarn install` + `node dist/index.js`). To distribute real,
double-click/PATH-installable binaries for macOS, Windows, and Linux — built
and published to GitHub Releases automatically, with version bumps also
triggerable as a GitHub Action rather than done by hand — this doc records
the packaging mechanics and the tradeoffs behind them.

Constraints fixed up front:
- **No Apple Developer account exists yet.** Proper Developer ID signing +
  notarization (the only way to avoid Gatekeeper blocking the binary on
  someone else's Mac) needs one ($99/yr). The pipeline is built with real
  signing wired in but gated on secrets that don't exist yet, falling back
  to ad-hoc signing until the gap is closed (see `docs/RELEASING.md`).
- **Packaging: Node.js's built-in Single Executable Applications (SEA)**,
  not a third-party packager (`pkg`, `nexe`) — official, no extra packaging
  dependency to track.
- **Versioning: a manual `workflow_dispatch` bump**, not Changesets — one
  Action, run by hand, choosing patch/minor/major.
- Both `spork` (`@spork/cli`) and `spork-mcp` (`@spork/mcp`) ship as binaries.

## Design

### SEA needs its own entry point

Both `packages/cli/src/index.ts` and `packages/mcp/src/index.ts` gate
execution behind `import.meta.url === file://${process.argv[1]}` so that
importing them (e.g. from a test) doesn't also run `main()`. Inside a SEA
binary there's no separate "script path" — `process.argv[1]` is just the
first CLI argument, not an entry file — so that check always evaluates to
`false` there. Rather than complicate the existing guard, each package gets
a tiny dedicated `src/sea-entry.ts` that calls the already-tested `main`
(and its error handler) directly and unconditionally. This is the file
the packaged binary's bundle actually treats as its entry point — `index.ts`
and its npm-run behavior are untouched.

### Build natively per OS, never cross-compile

`tools/package-binary/build.ts` builds the SEA binary for the *current*
OS/arch only. The release workflow's job matrix runs this script natively on
a macOS, Windows, and Linux runner rather than cross-compiling from one —
this sidesteps SEA's core limitation (the `node` binary a blob is injected
into must be the same build it was generated against). Per binary, it:

1. Bundles the entry (`esbuild`, `--bundle --platform=node --format=cjs`) —
   SEA requires a single CommonJS file.
2. Writes a `sea-config.json` and runs `node --experimental-sea-config`.
3. Copies the running `node` binary, strips its existing (now-stale)
   signature on macOS, and injects the blob via `postject`
   (`NODE_SEA_BLOB`/`NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
   `--macho-segment-name NODE_SEA` on macOS only — exact values straight
   from Node's own SEA docs).

This produces an **unsigned** binary on every OS — real signing is a
separate, OS-specific concern layered on top (see below), not something
`build.ts` itself knows about.

Verified by actually running the pipeline end-to-end on this machine
(macOS arm64): the unsigned binary straight out of `build.ts` is killed
outright by the OS (`SIGKILL`, exit 137) the instant it's run — on Apple
Silicon, *any* code integrity violation (and stripping + re-injecting a
previously-signed `node` binary is one) is fatal, not just a Gatekeeper
warning. Ad-hoc signing (`codesign --sign -`, `macos-sign.sh`'s fallback
with no cert configured) is enough to make it runnable again; confirmed
`--help`/`--version`/`workspace list` all behave identically to the
plain `node dist/index.js` equivalent once signed. This means
`macos-sign.sh` is not an optional distribution nicety on macOS — every
macOS build leg must run it, cert or no cert, which `release-build.yml`
already does unconditionally.

### macOS signing/notarization: gated on secrets, with a documented fallback

`tools/package-binary/macos-sign.sh`: if `MACOS_CERTIFICATE` is set, imports
it into a temporary keychain, signs with `--options runtime --timestamp
--entitlements entitlements.plist` (the same entitlement set Node's own
official macOS binary has shipped with since it adopted the hardened
runtime — `allow-jit`, `allow-unsigned-executable-memory`,
`disable-executable-page-protection`, `disable-library-validation`,
`allow-dyld-environment-variables`), then — if notarization credentials are
also set — zips a copy (`ditto -c -k --keepParent`, since `notarytool`
only accepts a zip/dmg/pkg, never a bare executable) and submits it via
`xcrun notarytool submit --wait`.

**No stapling.** Apple's `stapler staple` only supports `.app`/`.pkg`/`.dmg`
bundles — stapling a bare executable fails outright (error 73). A
standalone signed, notarized binary instead gets its notarization status
checked online by Gatekeeper the first time it runs, which needs network
access once. Shipping an installer package instead (which *could* be
stapled) was considered and rejected as unnecessary scope — nothing about
"ship a CLI binary" requires an installer, and it would need a second,
separate "Developer ID Installer" certificate.

With no `MACOS_CERTIFICATE` set (true today), the script ad-hoc signs
(`codesign --sign -`) instead — the binary runs locally but still trips
Gatekeeper for anyone else who downloads it (worked around with
right-click → Open, or `xattr -d com.apple.quarantine`). This is documented
in the README/release notes, not silently papered over.

### Versioning: one shared version across every package, patched in two places code reads it

`tools/release/bump-version.ts` bumps the root `package.json` plus every
`packages/*/package.json` in lockstep, and additionally patches two
hardcoded version-string literals that can't be read from `package.json` at
runtime inside a packaged SEA binary: `@spork/cli`'s `.version(...)` call
and `@spork/mcp`'s `McpServer({ version })`. No changelog file — GitHub's
`gh release create --generate-notes` covers that from commit history.

### Two workflows, chained by a tag push

`release-bump.yml` (`workflow_dispatch`) bumps, commits, and pushes a
`vX.Y.Z` tag to `main`. That tag push is what triggers `release-build.yml`
(`on: push: tags: ['v*']`) — no manual coupling between the two. The build
job matrix is `{macos-14/arm64, macos-13/x64, windows-latest/x64,
ubuntu-latest/x64}`; a release job downloads every matrix leg's artifacts
and runs `gh release create --generate-notes`.

## Known risk: GitHub-hosted Intel macOS runner availability

GitHub has been retiring hosted x64 macOS runners in favor of Apple
Silicon-only. Whether `macos-13` is still schedulable isn't something to
assume from here — the first real run of `release-build.yml` confirms it
one way or the other. If it's gone, drop that matrix leg and ship arm64-only
Mac binaries, noted as a follow-up in `docs/RELEASING.md`.
