# tools/readme-sync

The CI check that keeps module documentation honest. It does **not** write or
generate README content — see the
[readme-sync skill](../../.claude/skills/readme-sync/SKILL.md) for that. This
only checks that a README.md diff *exists* alongside a module's source diff.

## How it works

`check.ts` diffs the current branch against a base ref (`--base <ref>`,
default `main`), and for every changed file under `packages/` or `tools/`
(README.md changes themselves excluded), walks up from that file's directory
— never past its `packages/<name>` or `tools/<name>` root — looking for the
nearest `README.md`. If that README wasn't also part of the diff, the module
is reported as a violation. Each module is reported at most once, no matter
how many of its files changed.

Deliberately scoped to `packages/` and `tools/` only (not the whole repo) —
those are where a README is expected to describe a module's source, so an
incidental root-level change (e.g. bumping a dependency) doesn't get flagged.

## Usage

```sh
yarn readme-sync:check                    # diffs against origin/main
yarn readme-sync:check --base origin/main # explicit base ref (what CI passes)
```

Exits non-zero and lists the offending modules if any are found.
