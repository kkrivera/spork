#!/usr/bin/env bash
set -euo pipefail

# Signs (and, when credentials are present, notarizes) a macOS SEA binary
# produced by build.ts.
#
# Usage: macos-sign.sh <path-to-binary>
#
# With no secrets set, falls back to ad-hoc signing (`codesign --sign -`):
# the binary runs locally but still trips Gatekeeper for anyone else who
# downloads it (right-click > Open, or `xattr -d com.apple.quarantine`,
# works around it). See docs/RELEASING.md for the one-time setup — a
# Developer ID Application certificate plus an App Store Connect API key —
# that activates real signing and notarization below.

BINARY_PATH="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="${RUNNER_TEMP:-$(mktemp -d)}"

if [[ -z "${MACOS_CERTIFICATE:-}" ]]; then
  echo "macos-sign: no MACOS_CERTIFICATE secret set — ad-hoc signing only."
  codesign --sign - --force "$BINARY_PATH"
  exit 0
fi

KEYCHAIN_PATH="$TMP_DIR/spork-signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
CERT_PATH="$TMP_DIR/spork-cert.p12"
echo "$MACOS_CERTIFICATE" | base64 --decode >"$CERT_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERT_PATH" -P "$MACOS_CERTIFICATE_PWD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
# shellcheck disable=SC2046 # word-splitting the existing keychain list is intentional here
security list-keychains -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | sed 's/"//g')

SIGNING_IDENTITY="$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep 'Developer ID Application' | head -n1 | sed -E 's/.*"(.*)"/\1/')"
if [[ -z "$SIGNING_IDENTITY" ]]; then
  echo "macos-sign: no 'Developer ID Application' identity found in MACOS_CERTIFICATE." >&2
  exit 1
fi

codesign --sign "$SIGNING_IDENTITY" --options runtime --timestamp \
  --entitlements "$SCRIPT_DIR/entitlements.plist" --force "$BINARY_PATH"
rm -f "$CERT_PATH"

if [[ -z "${APPLE_API_KEY_P8:-}" ]]; then
  echo "macos-sign: signed with Developer ID but no notarization credentials set — skipping notarization."
  exit 0
fi

API_KEY_PATH="$TMP_DIR/apple-api-key.p8"
echo "$APPLE_API_KEY_P8" | base64 --decode >"$API_KEY_PATH"

# notarytool only accepts a zip/dmg/pkg, never a bare executable — this zip
# is a throwaway submission artifact, not the distributed binary.
NOTARIZE_ZIP="$TMP_DIR/$(basename "$BINARY_PATH").notarize.zip"
ditto -c -k --keepParent "$BINARY_PATH" "$NOTARIZE_ZIP"

xcrun notarytool submit "$NOTARIZE_ZIP" --wait \
  --key "$API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID"
rm -f "$NOTARIZE_ZIP" "$API_KEY_PATH"

# No `stapler staple`: Apple only supports stapling .app/.pkg/.dmg bundles,
# not a bare executable (it fails with error 73). Gatekeeper instead checks
# notarization status online the first time the binary runs, which needs
# network access once — see docs/RELEASING.md.
echo "macos-sign: signed and notarized $BINARY_PATH"
