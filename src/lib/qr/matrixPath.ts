/**
 * Converts a QR module matrix (true = dark module) into the `d` attribute of a
 * single SVG path. Horizontal runs of dark modules become one rectangle each,
 * which keeps the path short and the edges crisp at any size.
 *
 * @param matrix 2D boolean array representing the QR modules.
 * @param padding Optional module offset to pad the generated coordinates.
 */
export function matrixToSvgPath(
  matrix: ReadonlyArray<ReadonlyArray<boolean>> | null | undefined,
  padding: number = 0,
): string {
  if (!matrix || !Array.isArray(matrix) || matrix.length === 0) {
    return "";
  }

  const offset = Math.max(0, Number(padding) || 0);
  const parts: string[] = [];

  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    if (!row || !Array.isArray(row)) continue;
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      const run = x - start;
      const posX = start + offset;
      const posY = y + offset;
      parts.push(`M${posX} ${posY}h${run}v1h-${run}z`);
    }
  }

  return parts.join("");
}
