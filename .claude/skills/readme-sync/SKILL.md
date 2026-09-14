---
name: readme-sync
description: Regenerate a module's README.md so it accurately reflects its current source. Use after changing files inside a package/module directory, or when tools/readme-sync/check.ts fails a diff for missing a README update.
---

# readme-sync

Keeps a module's `README.md` honest by regenerating it from the module's current
source, rather than leaving READMEs to drift or be checked deterministically by a
script. CI (`tools/readme-sync/check.ts`) only verifies that a README.md diff
*exists* alongside a module's source diff — it does not check content, that's this
skill's job.

## When to use this

- You changed files inside a module directory (e.g. `packages/core/src/workspace/`,
  or any directory that has its own `README.md`) and need that README updated to
  match.
- `yarn readme-sync:check` failed and named a module.

## What "module" means here

Any directory with its own `README.md` — typically a `packages/*` package, or a
subdirectory of one that's substantial enough to document on its own (e.g.
`packages/core/src/workspace/`). Start at the README.md closest to the files you
changed.

## Steps

1. Read the module's current `README.md` in full.
2. Read every source file in the module (not just the changed ones — the README
   describes the whole module, and other parts may have drifted too).
3. Rewrite the README to cover, concisely:
   - What the module is for (one or two sentences, not a restatement of the
     directory name).
   - Its structure: the key files/subdirectories and what each is responsible for.
   - Its public surface: what it exports and how the rest of the repo is expected
     to use it (for a package, this is what `src/index.ts` exports).
   - How to build/test it, if that differs from the repo root commands.
4. Keep it short and scannable — a developer or another agent should be able to
   orient in under a minute. No restating obvious code, no changelog-style notes
   about "recently added X" (git history is the changelog).
5. Do not touch files outside the module and its README.

## Non-goals

- Do not write multi-paragraph prose or marketing copy.
- Do not invent behavior that isn't in the source.
- Do not modify source files — this skill only writes documentation.
