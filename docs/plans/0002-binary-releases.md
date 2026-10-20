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

### Cross-compiling: one or two runners build every target

`tools/package-binary/build.ts` builds the SEA binary for a given
OS/arch, defaulting to the host's own. When the target differs from the
host, it downloads that target's *official* node binary from
`nodejs.org/dist` (checksum-verified against the published
`SHASUMS256.txt`) and injects into that instead of the host's own
`process.execPath` — `downloadNodeBinary`. Per binary, the full sequence:

1. Bundles the entry (`esbuild`, `--bundle --platform=node --format=cjs`) —
   SEA requires a single CommonJS file.
2. Writes a `sea-config.json` (`useCodeCache`/`useSnapshot` both `false` —
   required for a cross-platform build per Node's own docs, since code
   cache/snapshots are only loadable on the platform that compiled them;
   this config also works fine for a native build, so there's no
   native/cross branch here) and runs `node --experimental-sea-config`.
3. Copies the target's node binary (native: `process.execPath`; foreign:
   `downloadNodeBinary`), strips its existing (now-stale) signature if
   both the *target* and the *host* are darwin (`codesign` only exists on
   macOS, so this can't run for any other target/host pair — not a
   problem in practice, see the job layout below), and injects the blob
   via `postject` (`NODE_SEA_BLOB`/
   `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, `--macho-segment-name
   NODE_SEA` on a darwin target only — exact values straight from Node's
   own SEA docs).

This produces an **unsigned** binary either way — real signing is a
separate, OS-specific concern layered on top (see below), not something
`build.ts` itself knows about.

**This is a real, verified capability, not just something the docs
mention.** Node's SEA docs do describe cross-platform builds (forcing
`useCodeCache`/`useSnapshot` off), but rather than trust that alone, this
was tested for real: downloaded the official `linux-x64` and `win-x64`
node binaries (exact version match required) onto a macOS machine,
built+injected both through the actual `build.ts`/`build-all.ts` code (not
just an ad-hoc shell spike), and **ran the resulting Linux binary inside a
real Debian container** — `--help`, `--version`, a real `workspace list`,
and the MCP server's `initialize` handshake all worked identically to a
native build. The Windows binary is structurally verified (valid PE32+,
the SEA sentinel fuse byte correctly flipped `0`→`1`, same mechanism that
worked for Linux) but not executed — no Windows/Wine available where this
was tested. A `darwin-x64` build was also verified: cross-*arch* (not
cross-OS) from a darwin-arm64 host, ad-hoc `codesign` succeeds on it (code
signing never requires executing the binary, so arch doesn't matter
there), and it actually **ran via Rosetta** on the arm64 host.

### Job layout: one macOS runner, one Linux runner

Given the above, every target can be *built* from two runners instead of
four — only macOS **signing** (`codesign`/`notarytool`) genuinely requires
a real Mac:

- **`build-mac`** (`macos-14`, Apple Silicon): builds both `darwin-arm64`
  (native) and `darwin-x64` (downloaded) via `yarn package:mac`, then
  signs all four resulting binaries (`spork`/`spork-mcp` × both arches) —
  codesign works cross-arch on the same host OS, so no new tooling is
  needed for the `x64` leg.
- **`build-other`** (`ubuntu-latest`): builds both `linux-x64` (native)
  and `win32-x64` (downloaded) via `yarn package:linux` + `yarn
  package:win` — no signing, same as before.

This removes the Intel-Mac-runner dependency entirely (not a workaround —
no x64 Mac runner is used anywhere in the pipeline anymore).

Root `package.json` also exposes this directly for local use:
`package:mac`/`package:win`/`package:linux` each build *every* relevant
arch for that platform regardless of which OS you run them on, and
`package:all` builds the full set of four targets × two binaries in one
call — all via `tools/package-binary/build-all.ts`, a thin loop over
`build.ts`'s `buildBinary`.

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
(`on: push: tags: ['v*']`) — no manual coupling between the two. The two
build jobs (`build-mac`, `build-other` — see above) each upload their own
artifact set; a `release` job downloads both and runs `gh release create
--generate-notes`.
