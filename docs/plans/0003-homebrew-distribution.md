# 0003 — Homebrew distribution

Status: Accepted

## Problem

`spork` already publishes standalone binaries to GitHub Releases (see
[0002-binary-releases.md](0002-binary-releases.md)). Downloading a tarball
and putting it on `PATH` by hand is still friction most Homebrew users
won't accept — this doc records how `brew install spork` works instead,
and what it took to automate without a second repo.

Constraints fixed up front:
- **One formula, `spork`, installs both binaries.** `spork-mcp` was
  originally left out (it's a backend an agent launches, not a CLI someone
  runs by hand), but that left it as a manual download with no upgrade
  path at all — see "spork-mcp ships in the same formula" below.
- **No second "tap" repo.** The canonical Homebrew pattern is a dedicated
  `<user>/homebrew-<name>` repo; this project's repo is just `spork`.
  Homebrew's tap command accepts an explicit URL for exactly this case
  (`brew tap kkrivera/spork https://github.com/kkrivera/spork`), so the
  formula lives in this repo's own `Formula/` directory instead of a repo
  someone has to remember to keep in sync.
- **macOS + Linux**, both architectures Homebrew itself supports widely
  (`arm64`/`x86_64` on macOS, `x86_64` on Linux) — every one of those
  already has a published release archive from 0002's pipeline. No
  `linux-arm64` archive exists yet, so that configuration has no `url` in
  the formula at all (an arm64 Linuxbrew user hitting this gets Homebrew's
  own "no url for this configuration" error, not a broken install).
- **The formula is generated, never hand-edited** — see below.

## Design

### Formula/spork.rb is rendered, not maintained by hand

A real release's `version`/`url`/`sha256` can only be known after
`release-build.yml` has actually built and published that version's
archives — there's nothing to hand-write correctly ahead of time, and
hand-editing three sha256 hashes after every tag is exactly the kind of
step that gets forgotten or fat-fingered.

`tools/homebrew-formula/generate-formula.ts` (see its own README) renders
`tools/homebrew-formula/spork.rb.template` — the one place the formula's
actual Ruby structure (the `on_macos`/`on_arm`/`on_intel`/`on_linux` blocks,
`install`, `test`) is written and reviewed — into `Formula/spork.rb`,
substituting `{{VERSION}}`/`{{DARWIN_ARM64_SHA256}}`/`{{DARWIN_X64_SHA256}}`/
`{{LINUX_X64_SHA256}}` after computing each archive's real sha256 locally
(never trusted from anywhere else — that's exactly what `brew install`
itself re-verifies). Every run re-renders the whole file, so it's
idempotent regardless of the previous release's values — no diffing or
partial patching to get wrong.

`release-build.yml`'s `release` job runs this right after `gh release
create` (which is what actually publishes the archives the formula's
`url`s point at) and commits `Formula/spork.rb` straight to `main` if it
changed — the same direct-push pattern `release-bump.yml` already uses for
the version-bump commit, under the same `contents: write` permission.

### spork-mcp ships in the same formula

`spork-mcp` is released in lockstep with `spork` (same tag, same version,
same targets), so it's a `resource` inside the `spork` formula rather than
a second formula: one `brew install spork` gets both, and one `brew
upgrade spork` keeps both current. Each `on_arm`/`on_intel` block carries
its own `resource "spork-mcp"` next to that platform's main `url`, so the
right architecture's archive is picked the same way, and `install` stages
it into the same `bin`. The path an agent is registered against,
`$(brew --prefix)/bin/spork-mcp`, is a stable symlink that survives every
upgrade, so registering it once (`claude mcp add`) is enough.

A separate `spork-mcp` formula was considered and rejected: it would only
help someone who wants the MCP server without the CLI (or vice versa),
which nobody has asked for, at the cost of two packages to install and
upgrade and a second formula to generate. Folding the server into the
`spork` binary itself (a `spork mcp` subcommand) would simplify further
still, but is an architecture change to `@spork/cli` — not needed to fix
installs and upgrades.

### Before the first real release

Nothing has been tagged yet as of this writing, so there's no real
archive to hash. `Formula/spork.rb` is checked in anyway, rendered with
placeholder `0.0.0-unreleased` values and the sha256 of an empty file —
enough to keep it syntactically real (`brew style`/`ruby -c` both pass,
and `brew tap`/`brew audit` resolve the formula cleanly) without claiming a
downloadable asset exists. The very first tag push replaces it with real
values, same as every release after.

## Installing

```sh
brew tap kkrivera/spork https://github.com/kkrivera/spork
brew install spork
```

Both `spork` and `spork-mcp` land in `$(brew --prefix)/bin`.

No Gatekeeper "unidentified developer" prompt here, unlike a binary
downloaded straight from the release page — confirmed directly: Homebrew
fetches over plain `curl`, which never sets the `com.apple.quarantine`
extended attribute a browser download does (only `com.apple.provenance`,
an unrelated, non-blocking one), so there's nothing for Gatekeeper's
first-launch check to act on. The binary still needs *some* signature to
run at all on Apple Silicon — satisfied by the ad-hoc signature
`buildBinary` already applies (see 0002) — but that's silent, no prompt.
