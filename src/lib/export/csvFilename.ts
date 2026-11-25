const INVALID_CSV_FILENAME_CHARACTERS = /[^a-zA-Z0-9_-]/gu;
const CSV_EXTENSION_SUFFIX = /(?:\.csv)+$/i;
const HAS_SAFE_CSV_FILENAME_CHARACTER = /[a-zA-Z0-9_-]/u;

export function sanitizeCsvFilenameStem(
  name: string | null | undefined,
): string {
  if (typeof name !== "string" || !name) {
    return "folder";
  }

  const sanitized = name.replace(INVALID_CSV_FILENAME_CHARACTERS, "_");
  return HAS_SAFE_CSV_FILENAME_CHARACTER.test(name) ? sanitized : "folder";
}

export function sanitizeCsvFilename(
  name: string | null | undefined,
): string {
  const stem =
    typeof name === "string" ? name.replace(CSV_EXTENSION_SUFFIX, "") : "";

  return `${sanitizeCsvFilenameStem(stem)}.csv`;
}

export function buildCsvContentDisposition(
  filename: string | null | undefined,
): string {
  const safeFilename = sanitizeCsvFilename(filename);
  return `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`;
}
