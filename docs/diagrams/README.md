# Diagrams

Standalone [Mermaid](https://mermaid.js.org) (`.mmd`) source files for flows
that are easier to follow as a picture than as prose. Paste a file's
contents into the [Mermaid Live Editor](https://mermaid.live) to render it,
or view it in an editor with Mermaid preview support.

- [add-repo-workflow.mmd](add-repo-workflow.mmd) — what `spork workspace
  add-repo` does end to end: reconcile, the locked bare-clone/worktree-add
  section, manifest + `.code-workspace` writes, and the submodule-init step
  (see [core/src/git/submodule.ts](../../packages/core/src/git/submodule.ts)
  and [0001-worktree-workspace-architecture.md](../plans/0001-worktree-workspace-architecture.md)).

Keep these current when the flow they describe changes — same spirit as the
per-module README convention, just for pictures instead of prose.
