/** Lowercases, strips anything but [a-z0-9], and collapses runs into single hyphens. */
export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'x'
}
