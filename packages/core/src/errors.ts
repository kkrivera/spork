/** A user-facing domain error (bad input, a naming collision, a missing entry) — not a bug. */
export class SporkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SporkError'
  }
}
