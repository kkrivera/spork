---
name: changelog
description: Write the CHANGELOG.md entry for a spork release from the commits since the previous release tag. Use when the changelog-check hook reports a release tag with no CHANGELOG.md entry, or when asked to write or update the changelog.
---

# changelog

`CHANGELOG.md` at the repo root has one section per release tag (`vX.Y.Z`),
newest first. Releases are cut by the `release-bump.yml` GitHub Action,
which never writes the changelog, so each release's entry is written here
afterwards, reviewed by the user, then committed and pushed.

The `.claude/hooks/changelog-check.sh` hook lists the tags that have no
entry yet, at session start and after each prompt.

## Steps

1. **Find the missing releases.** Run `git fetch --tags origin` first, then
   compare `git tag --list 'v*' --sort=v:refname` against the `## [X.Y.Z]`
   headings in `CHANGELOG.md`. Handle each missing tag, oldest first.
2. **Read the release's commits.** For tag `vX.Y.Z` with previous tag
   `vP`:

   ```sh
   git log --reverse --no-merges --format='--- %h %s%n%b' vP..vX.Y.Z
   ```

   For the first release, use the tag alone (all history up to it).
   Leave out the release bot's own commits: `chore(release): …` and
   `chore(homebrew): …`. When a commit message doesn't make the
   user-visible effect clear, read the change itself (`git show --stat
   <sha>`, then the relevant diff).
3. **Write the section** using the rules below, and insert it in
   `CHANGELOG.md` above the previous release's section (create the file
   with the header below if it doesn't exist). Add the release's link
   definition at the bottom, keeping those newest first too.
4. **Show it to the user and wait.** Print the new section(s) in full and
   ask them to review. Apply their edits. Don't commit until they approve.
5. **Commit and push.** On `main`, commit only `CHANGELOG.md` as
   `docs(changelog): add vX.Y.Z` (or `add vA, vB` for several), then
   `git push origin main`. Then go back to whatever the user had asked
   for before this started.

## File format

```markdown
# Changelog

What changed in each spork release, newest first. Install or upgrade with
`brew upgrade spork`, or download from the
[releases page](https://github.com/kkrivera/spork/releases).

## [1.2.0] - 2026-11-02

### Added

- …

### Fixed

- …

[1.2.0]: https://github.com/kkrivera/spork/releases/tag/v1.2.0
```

- The heading is `## [X.Y.Z] - YYYY-MM-DD`: the version without the `v`,
  and the tag's commit date (`git log -1 --format=%cs vX.Y.Z`). The hook
  matches on `## [X.Y.Z]`, so keep that part exact.
- Groups, in this order, each only if it has entries: **Breaking**,
  **Added**, **Changed**, **Fixed**, **Removed**.
- A release with nothing a user would notice gets one line instead of
  groups: `No user-facing changes.`

## Writing rules

- **The reader installed spork with `brew` and uses its commands.** Write
  about what they can now do, or what behaves differently for them, not
  how it's built. "`workspace create` asks for a missing SSH key's
  passphrase" rather than "thread `sshAuthSock` through `addRepo`".
- **Leave out what users never see**: refactors, tests, CI, lint rules,
  internal docs and design docs, the release tooling itself. Include a
  README change only when it documents something new for users.
- **Every bullet must come from the release's commits.** Don't describe
  anything you can't point to a commit for, and don't guess at behavior:
  check the diff.
- **One bullet per change a user would notice**, merging the commits that
  built it. Usually one sentence, at most two. Name commands, flags and
  environment variables in backticks, exactly as typed.
- **Plain, present tense**: "`repo scan` defaults to the current
  directory", "Fixes `workspace create` failing when…". No marketing
  words, no "now" in every bullet.
- **Breaking** is for anything that could stop an existing command, script
  or flag from working as before. Say what to do instead.
