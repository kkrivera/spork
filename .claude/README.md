# .claude

Claude Code configuration for working on this repo.

- [skills/](skills/) — repo-local skills invoked with `/<skill-name>` (or
  automatically, per skill) to keep this repo's conventions consistent:
  - [readme-sync](skills/readme-sync/SKILL.md) — regenerate a module's `README.md`
    from its current source.
  - [new-package](skills/new-package/SKILL.md) — scaffold a new `packages/<name>`
    package with this repo's standard boilerplate.
  - [changelog](skills/changelog/SKILL.md) — write a release's
    `CHANGELOG.md` entry from its commits, for the user to review.
- [hooks/](hooks/) — scripts that [settings.json](settings.json) runs on Claude
  Code events:
  - [changelog-check.sh](hooks/changelog-check.sh) — at session start (after
    fetching tags) and after each prompt, lists release tags with no
    `CHANGELOG.md` entry, so Claude writes them with the changelog skill
    before anything else. At session start it always reports; after a
    prompt, only when the set of missing tags has changed.

See the root [CLAUDE.md](../CLAUDE.md) for overall project context and conventions.
