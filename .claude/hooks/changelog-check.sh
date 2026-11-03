#!/bin/sh
# Claude Code hook: tells Claude about release tags with no CHANGELOG.md
# entry, so it writes them (with the changelog skill) before anything else.
#
#   changelog-check.sh session-start   fetch tags, then always report
#   changelog-check.sh prompt          local tags only; report each set once
#
# Whatever this prints goes into Claude's context. It never fails the hook:
# a missing remote or a slow network just means no report this time.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
event=$1

if [ "$event" = "session-start" ]; then
  # Prompts off, like spork itself: a hook must never wait on a passphrase.
  GIT_TERMINAL_PROMPT=0 SSH_ASKPASS=false SSH_ASKPASS_REQUIRE=force \
    git fetch --quiet --tags origin >/dev/null 2>&1 </dev/null
fi

missing=""
for tag in $(git tag --list 'v[0-9]*' --sort=v:refname); do
  version=${tag#v}
  grep -qF "## [$version]" CHANGELOG.md 2>/dev/null || missing="$missing $tag"
done
missing=${missing# }

state="$(git rev-parse --git-dir)/changelog-check-reported"
if [ -z "$missing" ]; then
  rm -f "$state"
  exit 0
fi
if [ "$event" = "prompt" ] && [ "$(cat "$state" 2>/dev/null)" = "$missing" ]; then
  exit 0
fi
printf '%s\n' "$missing" > "$state"

cat <<EOF
Release tag(s) with no CHANGELOG.md entry: $missing.
Before working on the user's request, tell them this, then use the changelog
skill to write the missing entries. Show the entries to the user and wait for
their approval. Once they approve, commit CHANGELOG.md on main and push it,
then continue with what the user asked for.
EOF
