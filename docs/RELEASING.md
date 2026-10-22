# Releasing spork

See [docs/plans/0002-binary-releases.md](plans/0002-binary-releases.md) and
[docs/plans/0003-homebrew-distribution.md](plans/0003-homebrew-distribution.md)
for the design behind this. This doc is the operational runbook.

## Cutting a release

1. Go to the repo's **Actions** tab → **Release — bump version** →
   **Run workflow** → pick `patch`/`minor`/`major`.
2. That workflow bumps every package's version, commits it to `main`, and
   pushes a `vX.Y.Z` tag.
3. The tag push automatically triggers **Release — build binaries**, which
   builds `spork` and `spork-mcp` for macOS (arm64 + x64), Windows (x64),
   and Linux (x64), publishes them as a GitHub Release with the tag's name,
   and regenerates `Formula/spork.rb` from the new release's archives
   (committed straight to `main`).

Nothing else to do — steps 2–3 are fully automatic once step 1 is run.

## macOS signing status

**As of this writing, there is no Apple Developer account**, so macOS
binaries are only **ad-hoc signed**. They run fine once built locally, but
anyone who downloads one hits a Gatekeeper block on first run and has to
either:

- right-click the binary → **Open** → confirm in the dialog that appears, or
- run `xattr -d com.apple.quarantine <path-to-binary>`.

Mention this in the release notes until it's closed out below.

## One-time setup: enabling real signing + notarization

Once there's a paid Apple Developer Program membership ($99/yr), do this
once — after which `release-build.yml`'s `macos-sign.sh` step picks it up
automatically, no code changes needed:

### 1. Create a Developer ID Application certificate

1. In Xcode (or [developer.apple.com](https://developer.apple.com) → Certificates), create a
   **Developer ID Application** certificate for the team.
2. Export it from Keychain Access as a `.p12`, with a password.
3. `base64 -i Certificate.p12 | pbcopy`

### 2. Create an App Store Connect API key (for notarization)

1. [App Store Connect](https://appstoreconnect.apple.com) → **Users and Access** → **Integrations** →
   **Keys** → create a key with the **Developer** role.
2. Download the `.p8` key (only downloadable once).
3. Note its **Key ID** and **Issuer ID** (shown on the same page).
4. `base64 -i AuthKey_XXXX.p8 | pbcopy`

### 3. Add repo secrets

Settings → Secrets and variables → Actions → New repository secret, for
each of:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE` | base64 `.p12` from step 1 |
| `MACOS_CERTIFICATE_PWD` | the password chosen when exporting the `.p12` |
| `APPLE_API_KEY_P8` | base64 `.p8` from step 2 |
| `APPLE_API_KEY_ID` | the Key ID from step 2 |
| `APPLE_API_ISSUER_ID` | the Issuer ID from step 2 |

That's it — the next tag push signs and notarizes all four macOS/arch
binaries automatically.

## Known follow-ups

- **No stapling.** A bare CLI binary can't be stapled (only `.app`/`.pkg`/
  `.dmg` can) — Gatekeeper checks notarization status online on first run
  instead, which needs network access once. Not an issue in practice, but
  worth knowing if someone reports a slow first launch.
- **Windows/Linux binaries are unsigned.** Windows may show a SmartScreen
  "unknown publisher" prompt on first run; there's no equivalent blocker on
  Linux. Neither is currently in scope to fix — revisit if it becomes a
  real adoption blocker.
- **No `linux-arm64` archive.** `brew install spork` on an arm64 Linuxbrew
  host has no `url` to fall back to in `Formula/spork.rb` — add that
  target to `release-build.yml`/`build-all.ts` first if that platform ever
  needs support.
