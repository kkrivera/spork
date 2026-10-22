# tools/homebrew-formula

Regenerates `Formula/spork.rb` (the Homebrew formula for the `spork` CLI
only — `spork-mcp` has no formula, see
[docs/plans/0003-homebrew-distribution.md](../../docs/plans/0003-homebrew-distribution.md))
from the release archives `release-build.yml` already publishes. Run as
part of that same GitHub Action, right after the GitHub Release is
created — see [docs/RELEASING.md](../../docs/RELEASING.md).

## How it works

`generate-formula.ts --version <x.y.z> [--artifacts-dir <dir>]`:

1. Computes the real sha256 of that version's `spork-<version>-darwin-arm64.tar.gz`,
   `spork-<version>-darwin-x64.tar.gz`, and `spork-<version>-linux-x64.tar.gz`
   (`sha256File`) — recomputed locally rather than trusted from anywhere
   else, since that's exactly what Homebrew itself re-verifies on install.
   `spork-mcp`'s archives are untouched; this never reads them.
2. Renders `spork.rb.template` with those three hashes plus the version
   (`renderFormula` — simple `{{TOKEN}}` substitution, re-rendering the
   whole file every run so it's idempotent regardless of the previous
   release's values) and writes the result to `Formula/spork.rb`.

`Formula/spork.rb` is never hand-edited — every byte of it comes from this
template, regenerated on each release. Before the first real tagged
release, it holds placeholder `0.0.0-unreleased` values with the sha256 of
an empty file, just enough to keep it syntactically valid
(`brew style`/`ruby -c` both pass) without claiming a real downloadable
asset exists yet.

## Usage

```sh
yarn homebrew:update-formula --version 1.2.3 --artifacts-dir artifacts
```

`--artifacts-dir` defaults to `artifacts` (where `release-build.yml`
downloads every build job's archives via `merge-multiple: true`, so all of
them land flat in one directory).
