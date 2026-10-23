/**
 * Converts a QR module matrix (true = dark module) into the `d` attribute of a
 * single SVG path. Horizontal runs of dark modules become one rectangle each,
 * which keeps the path short and the edges crisp at any size.
 */
export function matrixToSvgPath(
  matrix: ReadonlyArray<ReadonlyArray<boolean>>,
): string {
  const parts: string[] = [];

  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      const run = x - start;
      parts.push(`M${start} ${y}h${run}v1h-${run}z`);
    }
  }

  return parts.join("");
}
