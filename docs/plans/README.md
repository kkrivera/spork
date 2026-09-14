# Plans

Design docs for non-trivial changes, written and reviewed before (or alongside)
the implementation — the same way code is reviewed.

## Convention

- File name: `NNNN-short-title.md`, numbered sequentially.
- Each doc starts with a `Status:` line — `Draft`, `Accepted`, or `Implemented`.
- Write one before starting a change that touches multiple modules, introduces a
  new architectural pattern, or would be expensive to redo if the approach turns
  out wrong. A one-file bugfix doesn't need one.
- Update the doc if the implementation ends up diverging from it in a meaningful
  way — it should stay a true description of the system, not just a historical
  proposal.
