import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

/**
 * Status of an individual partition backup archive.
 */
export type BackupVerificationStatus =
  | "VALID"
  | "CORRUPTED"
  | "ZERO_BYTE"
  | "MISSING_CHECKSUM"
  | "CHECKSUM_MISMATCH"
  | "INVALID_MAGIC_BYTES"
  | "DECOMPRESSION_FAILED"
  | "INVALID_SQL_STRUCTURE";

export interface PartitionBackupReport {
  fileName: string;
  partitionName: string;
  filePath: string;
  fileSizeBytes: number;
  status: BackupVerificationStatus;
  hasGzipMagicBytes: boolean;
  checksumMatched: boolean | null;
  expectedChecksum?: string;
  actualChecksum?: string;
  uncompressedSizeBytes?: number;
  errorMessage?: string;
}

export interface VerificationSummary {
  scannedDirectory: string;
  totalArchives: number;
  validArchives: number;
  corruptedArchives: number;
  zeroByteArchives: number;
  timestamp: string;
  reports: PartitionBackupReport[];
}

/**
 * GZIP magic bytes: 0x1F 0x8B
 */
const GZIP_MAGIC_BYTE_0 = 0x1f;
const GZIP_MAGIC_BYTE_1 = 0x8b;

/**
 * Validates whether the first two bytes of a file match the standard GZIP header magic bytes (0x1f, 0x8b).
 */
export function verifyGzipMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 2) {
    return false;
  }
  return buffer[0] === GZIP_MAGIC_BYTE_0 && buffer[1] === GZIP_MAGIC_BYTE_1;
}

/**
 * Calculates the SHA-256 hex digest of a buffer.
 */
export function calculateSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Checks for companion checksum files (e.g., <file>.sha256 or checksums.txt)
 * Returns the expected hex checksum string if found, otherwise null.
 */
export function findExpectedChecksum(archiveFilePath: string): string | null {
  const dir = path.dirname(archiveFilePath);
  const baseName = path.basename(archiveFilePath);

  // 1. Direct .sha256 file: e.g. PushNotificationLog_y2026m01.sql.gz.sha256
  const sha256File = `${archiveFilePath}.sha256`;
  if (fs.existsSync(sha256File)) {
    try {
      const content = fs.readFileSync(sha256File, "utf-8").trim();
      // Match 64-char hex string (standard sha256 output, possibly with filename)
      const match = /([a-fA-F0-9]{64})/.exec(content);
      if (match) {
        return match[1].toLowerCase();
      }
    } catch {
      // Ignore read errors
    }
  }

  // 2. Directory-level checksums file (checksums.txt / SHA256SUMS)
  const checksumManifestNames = ["checksums.txt", "SHA256SUMS", "checksums.sha256"];
  for (const manifestName of checksumManifestNames) {
    const manifestPath = path.join(dir, manifestName);
    if (fs.existsSync(manifestPath)) {
      try {
        const lines = fs.readFileSync(manifestPath, "utf-8").split("\n");
        for (const line of lines) {
          if (line.includes(baseName)) {
            const match = /([a-fA-F0-9]{64})/.exec(line);
            if (match) {
              return match[1].toLowerCase();
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  return null;
}

/**
 * Basic SQL structural validation on decompressed partition dump.
 * Checks for common SQL dump statements such as CREATE TABLE, COPY, INSERT, ALTER TABLE, etc.
 */
export function validateSqlDumpStructure(decompressedSql: string): boolean {
  if (!decompressedSql || decompressedSql.trim().length === 0) {
    return false;
  }
  const normalized = decompressedSql.toUpperCase();
  // Valid partition dumps should contain standard PostgreSQL schema / data keywords
  const validKeywords = [
    "CREATE TABLE",
    "COPY ",
    "INSERT INTO",
    "ALTER TABLE",
    "SET SCHEMA",
    "POSTGRESQL",
  ];
  return validKeywords.some((keyword) => normalized.includes(keyword));
}

/**
 * Extracts a partition or table name from an archive file name.
 * e.g., "PushNotificationLog_y2026m01.sql.gz" -> "PushNotificationLog_y2026m01"
 */
export function extractPartitionName(fileName: string): string {
  return fileName.replace(/(\.sql\.gz|\.tar\.gz|\.gz|\.sql)$/i, "");
}

/**
 * Verifies an individual partition backup archive file.
 */
export function verifyPartitionArchive(filePath: string): PartitionBackupReport {
  const fileName = path.basename(filePath);
  const partitionName = extractPartitionName(fileName);

  if (!fs.existsSync(filePath)) {
    return {
      fileName,
      partitionName,
      filePath,
      fileSizeBytes: 0,
      status: "CORRUPTED",
      hasGzipMagicBytes: false,
      checksumMatched: false,
      errorMessage: "File does not exist",
    };
  }

  const stats = fs.statSync(filePath);
  const fileSizeBytes = stats.size;

  // Zero-byte archive check
  if (fileSizeBytes === 0) {
    return {
      fileName,
      partitionName,
      filePath,
      fileSizeBytes: 0,
      status: "ZERO_BYTE",
      hasGzipMagicBytes: false,
      checksumMatched: false,
      errorMessage: "Archive file is 0 bytes (empty file)",
    };
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    return {
      fileName,
      partitionName,
      filePath,
      fileSizeBytes,
      status: "CORRUPTED",
      hasGzipMagicBytes: false,
      checksumMatched: false,
      errorMessage: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 1. Verify GZIP Magic Bytes
  const hasGzipMagicBytes = verifyGzipMagicBytes(buffer);
  if (!hasGzipMagicBytes) {
    return {
      fileName,
      partitionName,
      filePath,
      fileSizeBytes,
      status: "INVALID_MAGIC_BYTES",
      hasGzipMagicBytes: false,
      checksumMatched: null,
      errorMessage: `Invalid gzip magic bytes: expected 0x1f 0x8b, received 0x${buffer[0]?.toString(16).padStart(2, "0") || "00"} 0x${buffer[1]?.toString(16).padStart(2, "0") || "00"}`,
    };
  }

  // 2. Validate Checksums (if checksum file exists)
  const actualChecksum = calculateSha256(buffer);
  const expectedChecksum = findExpectedChecksum(filePath);
  let checksumMatched: boolean | null = null;

  if (expectedChecksum) {
    checksumMatched = actualChecksum.toLowerCase() === expectedChecksum.toLowerCase();
    if (!checksumMatched) {
      return {
        fileName,
        partitionName,
        filePath,
        fileSizeBytes,
        status: "CHECKSUM_MISMATCH",
        hasGzipMagicBytes: true,
        checksumMatched: false,
        expectedChecksum,
        actualChecksum,
        errorMessage: `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
      };
    }
  }

  // 3. Decompress and verify SQL integrity
  let decompressedSql: string;
  try {
    const uncompressedBuffer = zlib.gunzipSync(buffer);
    decompressedSql = uncompressedBuffer.toString("utf-8");
    const uncompressedSizeBytes = uncompressedBuffer.length;

    // Check SQL structure
    if (!validateSqlDumpStructure(decompressedSql)) {
      return {
        fileName,
        partitionName,
        filePath,
        fileSizeBytes,
        status: "INVALID_SQL_STRUCTURE",
        hasGzipMagicBytes: true,
        checksumMatched,
        expectedChecksum: expectedChecksum ?? undefined,
        actualChecksum,
        uncompressedSizeBytes,
        errorMessage: "Decompressed content lacks valid SQL statements or schema definitions",
      };
    }

    return {
      fileName,
      partitionName,
      filePath,
      fileSizeBytes,
      status: "VALID",
      hasGzipMagicBytes: true,
      checksumMatched,
      expectedChecksum: expectedChecksum ?? undefined,
      actualChecksum,
      uncompressedSizeBytes,
    };
  } catch (err) {
    return {
      fileName,
      partitionName,
      filePath,
      fileSizeBytes,
      status: "DECOMPRESSION_FAILED",
      hasGzipMagicBytes: true,
      checksumMatched,
      expectedChecksum: expectedChecksum ?? undefined,
      actualChecksum,
      errorMessage: `Gzip decompression failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Scans a directory for partition backup archives and verifies each.
 */
export function scanAndVerifyBackups(
  targetDirectory: string,
  options: { filePattern?: RegExp } = {},
): VerificationSummary {
  const filePattern = options.filePattern || /\.(sql\.gz|gz)$/i;
  const reports: PartitionBackupReport[] = [];

  if (!fs.existsSync(targetDirectory)) {
    return {
      scannedDirectory: targetDirectory,
      totalArchives: 0,
      validArchives: 0,
      corruptedArchives: 0,
      zeroByteArchives: 0,
      timestamp: new Date().toISOString(),
      reports: [],
    };
  }

  const entries = fs.readdirSync(targetDirectory);
  for (const entry of entries) {
    // Only scan archives matching pattern, skip checksum files
    if (filePattern.test(entry) && !entry.endsWith(".sha256")) {
      const fullPath = path.join(targetDirectory, entry);
      if (fs.statSync(fullPath).isFile()) {
        reports.push(verifyPartitionArchive(fullPath));
      }
    }
  }

  const validArchives = reports.filter((r) => r.status === "VALID").length;
  const zeroByteArchives = reports.filter((r) => r.status === "ZERO_BYTE").length;
  const corruptedArchives = reports.filter(
    (r) => r.status !== "VALID" && r.status !== "ZERO_BYTE",
  ).length;

  return {
    scannedDirectory: targetDirectory,
    totalArchives: reports.length,
    validArchives,
    corruptedArchives,
    zeroByteArchives,
    timestamp: new Date().toISOString(),
    reports,
  };
}

/**
 * Formats a terminal-friendly table report.
 */
export function formatSummaryConsole(summary: VerificationSummary): void {
  console.log("\n=======================================================");
  console.log("       WorkSphere Partition Backup Verification       ");
  console.log("=======================================================");
  console.log(`Directory:   ${summary.scannedDirectory}`);
  console.log(`Scanned At:  ${summary.timestamp}`);
  console.log(`Total Files: ${summary.totalArchives}`);
  console.log(`Valid:       ${summary.validArchives}`);
  console.log(`Zero-Byte:   ${summary.zeroByteArchives}`);
  console.log(`Corrupted:   ${summary.corruptedArchives}`);
  console.log("-------------------------------------------------------");

  if (summary.reports.length === 0) {
    console.log("No partition backup archives found in target directory.");
  } else {
    for (const report of summary.reports) {
      const badge =
        report.status === "VALID"
          ? "[OK]"
          : report.status === "ZERO_BYTE"
            ? "[ZERO_BYTE]"
            : "[CORRUPTED]";
      console.log(
        `${badge.padEnd(12)} ${report.fileName} (${(report.fileSizeBytes / 1024).toFixed(2)} KB) -> Status: ${report.status}`,
      );
      if (report.errorMessage) {
        console.log(`             Reason: ${report.errorMessage}`);
      }
      if (report.actualChecksum) {
        console.log(`             SHA256: ${report.actualChecksum}`);
      }
    }
  }
  console.log("=======================================================\n");
}

/**
 * Command line entrypoint when executed directly.
 */
export function runCli(): void {
  const args = process.argv.slice(2);
  const targetDir =
    args[0] ||
    process.env.PARTITION_BACKUP_DIR ||
    path.join(process.cwd(), "backups", "partitions");

  console.log(`Starting partition backup verification on: ${targetDir}`);
  const summary = scanAndVerifyBackups(targetDir);
  formatSummaryConsole(summary);

  // If there are zero-byte files or corrupted archives, exit with non-zero status
  if (summary.zeroByteArchives > 0 || summary.corruptedArchives > 0) {
    console.error(
      `[ALERT] Backup integrity verification detected ${summary.corruptedArchives} corrupted and ${summary.zeroByteArchives} zero-byte archive(s)!`,
    );
    process.exit(1);
  }

  console.log("[SUCCESS] All scanned partition backup archives passed integrity verification.");
  process.exit(0);
}

// Execute when invoked directly
if (typeof process !== "undefined" && process.argv[1]) {
  const currentFilePath = path.resolve(process.argv[1]);
  const isDirectRun =
    currentFilePath.endsWith("verify-partition-backups.ts") ||
    currentFilePath.endsWith("verify-partition-backups.js");

  if (isDirectRun) {
    runCli();
  }
}
