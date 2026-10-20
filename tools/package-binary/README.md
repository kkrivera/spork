# tools/package-binary

Builds the standalone `spork`/`spork-mcp` binaries (no Node.js required to
run them) and, on macOS, signs/notarizes them. Run as a GitHub Action
(`release-build.yml`) — see
[docs/plans/0002-binary-releases.md](../../docs/plans/0002-binary-releases.md)
for the design and [docs/RELEASING.md](../../docs/RELEASING.md) for the
one-time Apple signing setup.

## How it works

`build.ts --entry <path> --name <name> [--out-dir <dir>] [--platform <p>]
[--arch <a>]` turns one entry point (e.g. `packages/cli/src/sea-entry.ts`)
into an unsigned Node.js
[Single Executable Application](https://nodejs.org/api/single-executable-applications.html)
for a given OS/arch target (defaulting to the host's own):

1. `bundle` — bundles the entry with `esbuild` into a single CommonJS file
   (SEA only supports one bundled script).
2. `writeSeaConfig` + `generateBlob` — writes a `sea-config.json`
   (`useCodeCache`/`useSnapshot` both `false`, required for a
   cross-platform build since those are only loadable on the platform that
   compiled them) and runs `node --experimental-sea-config` to produce the
   blob.
3. Gets a copy of the target's `node` binary — `copyNodeBinary` when the
   target matches the host, or `downloadNodeBinary` when it doesn't: this
   downloads the target's *official* node binary from `nodejs.org/dist`
   (exact version match required), verifies its sha256 against the
   published `SHASUMS256.txt` (`nodeArchiveName`/`nodeDownloadUrl`/
   `parseShasum`), extracts it (`tar` for `.tar.gz`, `unzip` for `.zip`),
   and caches the extracted binary so building several binaries for the
   same target only downloads/extracts once.
4. `removeExistingSignature` — strips the binary's stale Apple signature
   so `postject` can safely modify it. Only runs when *both* the target
   and the host are darwin (`codesign` only exists on macOS); otherwise a
   no-op (with a warning if the target was darwin but the host isn't —
   not a case the release workflow's job layout below ever hits).
5. `injectBlob` — injects the blob via `postject`, under the resource name
   `NODE_SEA_BLOB` (plus `--macho-segment-name NODE_SEA` on a darwin
   target).

**Cross-compiling is real and verified, not just documented by Node.**
Built+injected official `linux-x64`/`win-x64` node binaries on a macOS
host through this exact code, then actually ran the resulting Linux binary
inside a real Debian container (`--help`/`--version`/`workspace
list`/the MCP `initialize` handshake all worked). The Windows one is
structurally verified (valid PE32+, the SEA fuse byte correctly flipped)
but not executed — no Windows/Wine available where this was tested. A
`darwin-x64` build was also verified end to end from a `darwin-arm64`
host: ad-hoc `codesign` succeeded and it ran via Rosetta.

`build-all.ts [--platform darwin|win32|linux]` builds **both** `spork` and
`spork-mcp` for every target matching `--platform` (or all four —
`darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64` — if omitted),
writing each into its own `dist-sea/<platform>-<arch>/` subfolder. This is
what backs the root `package.json` scripts below, and what
`release-build.yml` calls.

`macos-sign.sh <path-to-binary>` signs the binary produced above — **not
optional on Apple Silicon**: confirmed by running the pipeline for real that
an injected-but-unsigned binary is killed outright by the OS (`SIGKILL`,
exit code 137) before it ever reaches user code, even locally. Ad-hoc
signing alone is enough to make it runnable again; a real Developer ID
signature only adds Gatekeeper-on-other-machines/notarization on top. With a
`MACOS_CERTIFICATE` secret set, it imports a Developer ID Application
certificate into a temporary keychain, signs with the hardened runtime and
`entitlements.plist`, and — if notarization credentials
(`APPLE_API_KEY_P8`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER_ID`) are also
set — notarizes it via `xcrun notarytool submit --wait`. It never staples
the result: Apple's `stapler` only supports `.app`/`.pkg`/`.dmg`, not a bare
executable, so a notarized binary instead gets checked online by Gatekeeper
the first time it runs. With no `MACOS_CERTIFICATE` set, it falls back to
ad-hoc signing (`codesign --sign -`) instead.

`entitlements.plist` is the hardened-runtime entitlement set a signed SEA
binary needs to actually run (it embeds the full V8/Node runtime, so it
needs the same entitlements Node's own official macOS binary ships with).

## Usage

```sh
yarn package:binary --entry packages/cli/src/sea-entry.ts --name spork   # one binary, one target
./tools/package-binary/macos-sign.sh dist-sea/spork                      # macOS only

yarn package:mac     # spork + spork-mcp, both darwin-arm64 and darwin-x64 (regardless of host OS)
yarn package:win     # spork + spork-mcp, win32-x64
yarn package:linux   # spork + spork-mcp, linux-x64
yarn package:all     # every target above, from one machine
```

`release-build.yml` runs `yarn package:mac` on one `macos-14` runner
(signing all four resulting binaries) and `yarn package:linux` + `yarn
package:win` on one `ubuntu-latest` runner — no Intel Mac/Windows runner
needed at all.
