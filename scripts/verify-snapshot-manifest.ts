import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type SnapshotChunkStatus =
  "VALID" | "MISSING" | "HASH_MISMATCH" | "READ_ERROR";

export interface SnapshotChunkResult {
  fileName: string;
  expectedHash: string;
  actualHash?: string;
  status: SnapshotChunkStatus;
  errorMessage?: string;
}

export type SnapshotManifestStatus =
  "VALID" | "FAILED" | "INVALID_MANIFEST" | "INVALID_INPUT";

export interface SnapshotManifestReport {
  manifestPath: string;
  chunksDirectory: string;
  status: SnapshotManifestStatus;
  totalChunks: number;
  validChunks: number;
  failedChunks: number;
  chunks: SnapshotChunkResult[];
  errors: string[];
}

interface ManifestEntry {
  fileName: string;
  expectedHash: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relativePath = path.relative(directory, candidate);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function invalidReport(
  manifestPath: string,
  chunksDirectory: string,
  status: "INVALID_MANIFEST" | "INVALID_INPUT",
  message: string,
): SnapshotManifestReport {
  return {
    manifestPath,
    chunksDirectory,
    status,
    totalChunks: 0,
    validChunks: 0,
    failedChunks: 0,
    chunks: [],
    errors: [message],
  };
}

/**
 * Parses standard SHA256SUMS lines: "<64-char hash><two spaces><file>"
 * or "<64-char hash><space><asterisk><file>".
 */
function parseManifest(contents: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  const seenFileNames = new Set<string>();

  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;

    const match =
      /^([a-fA-F0-9]{64})  (.+)$/.exec(line) ??
      /^([a-fA-F0-9]{64}) \*(.+)$/.exec(line);
    if (!match) {
      throw new Error(
        `Invalid SHA256SUMS entry on line ${index + 1}; expected a SHA-256 digest and relative filename`,
      );
    }

    const fileName = match[2];
    const normalizedName =
      process.platform === "win32" ? fileName.toLowerCase() : fileName;
    if (seenFileNames.has(normalizedName)) {
      throw new Error(
        `Duplicate chunk entry "${fileName}" on line ${index + 1}`,
      );
    }

    seenFileNames.add(normalizedName);
    entries.push({ fileName, expectedHash: match[1].toLowerCase() });
  }

  if (entries.length === 0) {
    throw new Error("Manifest contains no SHA256SUMS entries");
  }

  return entries;
}

/**
 * Verifies each listed chunk against the SHA256SUMS manifest. Since this
 * manifest format contains no expected sizes, a hash mismatch cannot identify
 * whether a chunk was truncated, corrupted, or otherwise modified.
 */
export function verifySnapshotManifest(
  manifestPath: string,
  chunksDirectory: string,
): SnapshotManifestReport {
  const resolvedManifestPath = path.resolve(manifestPath);
  const resolvedChunksDirectory = path.resolve(chunksDirectory);

  if (!manifestPath.trim() || !chunksDirectory.trim()) {
    return invalidReport(
      resolvedManifestPath,
      resolvedChunksDirectory,
      "INVALID_INPUT",
      "Provide a manifest path and a chunks directory",
    );
  }

  let contents: string;
  try {
    contents = readFileSync(resolvedManifestPath, "utf8");
  } catch (error) {
    return invalidReport(
      resolvedManifestPath,
      resolvedChunksDirectory,
      "INVALID_MANIFEST",
      `Failed to read manifest: ${errorMessage(error)}`,
    );
  }

  let entries: ManifestEntry[];
  try {
    entries = parseManifest(contents);
  } catch (error) {
    return invalidReport(
      resolvedManifestPath,
      resolvedChunksDirectory,
      "INVALID_MANIFEST",
      errorMessage(error),
    );
  }

  let chunksRoot: string;
  try {
    if (!statSync(resolvedChunksDirectory).isDirectory()) {
      return invalidReport(
        resolvedManifestPath,
        resolvedChunksDirectory,
        "INVALID_INPUT",
        "Chunks path is not a directory",
      );
    }
    chunksRoot = realpathSync(resolvedChunksDirectory);
  } catch (error) {
    return invalidReport(
      resolvedManifestPath,
      resolvedChunksDirectory,
      "INVALID_INPUT",
      `Failed to access chunks directory: ${errorMessage(error)}`,
    );
  }

  const resolvedChunkPaths = new Set<string>();
  for (const entry of entries) {
    const chunkPath = path.resolve(chunksRoot, entry.fileName);
    if (
      path.isAbsolute(entry.fileName) ||
      !isWithinDirectory(chunksRoot, chunkPath)
    ) {
      return invalidReport(
        resolvedManifestPath,
        resolvedChunksDirectory,
        "INVALID_MANIFEST",
        `Chunk path must stay inside the chunks directory: "${entry.fileName}"`,
      );
    }

    const normalizedPath =
      process.platform === "win32" ? chunkPath.toLowerCase() : chunkPath;
    if (resolvedChunkPaths.has(normalizedPath)) {
      return invalidReport(
        resolvedManifestPath,
        resolvedChunksDirectory,
        "INVALID_MANIFEST",
        `Multiple manifest entries resolve to the same chunk: "${entry.fileName}"`,
      );
    }
    resolvedChunkPaths.add(normalizedPath);
  }

  const chunks: SnapshotChunkResult[] = entries.map((entry) => {
    const chunkPath = path.resolve(chunksRoot, entry.fileName);

    try {
      const stats = statSync(chunkPath);
      if (!stats.isFile()) {
        return {
          ...entry,
          status: "READ_ERROR",
          errorMessage: "Chunk path is not a regular file",
        };
      }

      const actualPath = realpathSync(chunkPath);
      if (!isWithinDirectory(chunksRoot, actualPath)) {
        return {
          ...entry,
          status: "READ_ERROR",
          errorMessage: "Chunk resolves outside the chunks directory",
        };
      }

      const content = readFileSync(actualPath);
      const actualHash = createHash("sha256").update(content).digest("hex");
      if (actualHash !== entry.expectedHash) {
        return {
          ...entry,
          actualHash,
          status: "HASH_MISMATCH",
          errorMessage: `SHA-256 mismatch: expected ${entry.expectedHash}, got ${actualHash}`,
        };
      }

      return { ...entry, actualHash, status: "VALID" };
    } catch (error) {
      return {
        ...entry,
        status: hasErrorCode(error, "ENOENT") ? "MISSING" : "READ_ERROR",
        errorMessage: hasErrorCode(error, "ENOENT")
          ? "Chunk file is missing"
          : `Failed to read chunk: ${errorMessage(error)}`,
      };
    }
  });

  const validChunks = chunks.filter((chunk) => chunk.status === "VALID").length;
  const failedChunks = chunks.length - validChunks;

  return {
    manifestPath: resolvedManifestPath,
    chunksDirectory: resolvedChunksDirectory,
    status: failedChunks === 0 ? "VALID" : "FAILED",
    totalChunks: chunks.length,
    validChunks,
    failedChunks,
    chunks,
    errors: [],
  };
}

export function runCli(args: string[] = process.argv.slice(2)): number {
  if (args.length !== 2) {
    console.error(
      "Usage: npm run db:verify-snapshot-manifest -- <manifest-path> <chunks-directory>",
    );
    return 2;
  }

  const report = verifySnapshotManifest(args[0], args[1]);
  console.log(JSON.stringify(report, null, 2));
  if (
    report.status === "INVALID_INPUT" ||
    report.status === "INVALID_MANIFEST"
  ) {
    return 2;
  }

  return report.status === "VALID" ? 0 : 1;
}

if (
  process.argv[1] &&
  /verify-snapshot-manifest\.(?:ts|js)$/.test(path.basename(process.argv[1]))
) {
  process.exitCode = runCli();
}
