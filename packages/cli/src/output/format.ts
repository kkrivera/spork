/** Renders headers/rows as a simple space-padded table — no box drawing, so it stays clean piped or in CI. */
export function formatTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => (row[i] ?? '').length)))

  const renderRow = (cells: readonly string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()

  return [renderRow(headers), ...rows.map(renderRow)].join('\n')
}
