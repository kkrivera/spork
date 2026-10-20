# tools/package-binary

Builds the standalone `spork`/`spork-mcp` binaries (no Node.js required to
run them) and, on macOS, signs/notarizes them. Run as a GitHub Action
(`release-build.yml`), on each target OS natively — see
[docs/plans/0002-binary-releases.md](../../docs/plans/0002-binary-releases.md)
for the design and [docs/RELEASING.md](../../docs/RELEASING.md) for the
one-time Apple signing setup.

## How it works

`build.ts --entry <path> --name <name> [--out-dir <dir>]` turns one
entry point (e.g. `packages/cli/src/sea-entry.ts`) into an unsigned Node.js
[Single Executable Application](https://nodejs.org/api/single-executable-applications.html)
for the *current* OS/arch only — it never cross-compiles, since a SEA blob
must be injected into the same `node` build it was generated against:

1. `bundle` — bundles the entry with `esbuild` into a single CommonJS file
   (SEA only supports one bundled script).
2. `writeSeaConfig` + `generateBlob` — writes a `sea-config.json` and runs
   `node --experimental-sea-config` to produce the blob.
3. `copyNodeBinary` — copies the running `node` binary to the output path.
4. `removeExistingSignature` (macOS only) — strips the copied binary's
   stale Apple signature so `postject` can safely modify it.
5. `injectBlob` — injects the blob via `postject`, under the resource name
   `NODE_SEA_BLOB` (plus `--macho-segment-name NODE_SEA` on macOS).

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
yarn package:binary --entry packages/cli/src/sea-entry.ts --name spork
./tools/package-binary/macos-sign.sh dist-sea/spork   # macOS only
```
