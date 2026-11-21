import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { Client, type ClientConfig } from "pg";

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
  | "INVALID_SQL_STRUCTURE"
  | "STALE"
  | "RESTORE_FAILED"
  | "SCHEMA_VALIDATION_FAILED";

/**
 * Expected schema verification target for an archive.
 */
export interface ExpectedTableValidation {
  tableName: string;
  minRowCount?: number;
  expectedColumns?: string[];
}

/**
 * Verification configuration for backup drills and coverage.
 */
export interface ArchiveCoverageConfig {
  /**
   * Expected partition patterns, archive names, or table prefixes.
   * e.g., ["PushNotificationLog", "TelemetryRecord"] or regexes.
   */
  expectedPartitions?: string[];
  /**
   * Whether backup directory existence and finding archives is required.
   * If true (default), empty directories or missing backup directories fail.
   * If false, empty inventory is permitted and reported as success.
   */
  requireCoverage?: boolean;
  /**
   * Max archive age in milliseconds before an archive is considered stale.
   * If undefined, freshness check is skipped.
   */
  maxAgeMs?: number;
  /**
   * Injectable clock function for deterministic freshness checks.
   */
  now?: () => Date;
  /**
   * Isolated PostgreSQL database connection URL for restore drills.
   * Must point to a verified disposable/test database.
   */
  restoreDatabaseUrl?: string;
  /**
   * Client factory for custom or mocked pg connection.
   */
  pgClientFactory?: (config: ClientConfig) => Client;
  /**
   * Required PostgreSQL extensions to verify/install.
   */
  requiredExtensions?: string[];
  /**
   * Table / record invariant checks per partition.
   */
  tableValidations?: Record<string, ExpectedTableValidation>;
  /**
   * Maximum uncompressed archive size in bytes to prevent runaway memory usage.
   * Default: 100MB (100 * 1024 * 1024).
   */
  maxUncompressedSizeBytes?: number;
  /**
   * Timeout in milliseconds for executing restore drill. Default: 30000ms.
   */
  restoreTimeoutMs?: number;
}

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
  archiveTimestamp?: string;
  isStale?: boolean;
  restoredSuccessfully?: boolean;
  validatedTables?: string[];
  errorMessage?: string;
}

export interface VerificationSummary {
  scannedDirectory: string;
  totalArchives: number;
  validArchives: number;
  corruptedArchives: number;
  zeroByteArchives: number;
  staleArchives: number;
  restoreFailedArchives: number;
  missingExpectedArchives: string[];
  coveragePassed: boolean;
  restoreDrillPassed: boolean;
  timestamp: string;
  reports: PartitionBackupReport[];
  errors: string[];
}

/**
 * GZIP magic bytes: 0x1F 0x8B
 */
const GZIP_MAGIC_BYTE_0 = 0x1f;
const GZIP_MAGIC_BYTE_1 = 0x8b;

/**
 * Default maximum uncompressed archive size (100MB).
 */
export const DEFAULT_MAX_UNCOMPRESSED_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Default restore drill timeout (30s).
 */
export const DEFAULT_RESTORE_TIMEOUT_MS = 30_000;

/**
 * Known extensions required by WorkSphere's PostgreSQL schema.
 */
export const DEFAULT_REQUIRED_EXTENSIONS = ["vector", "pg_trgm", "postgis"];

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
 * Parses timestamp from partition backup archive name or metadata.
 * Supports:
 * - PushNotificationLog_y2026m01.sql.gz -> 2026-01-01T00:00:00.000Z
 * - TelemetryRecord_2026_10.sql.gz -> 2026-10-01T00:00:00.000Z
 * - telemetry-records-2026-10.sql.gz -> 2026-10-01T00:00:00.000Z
 * - audit_20260315_120000.sql.gz -> 2026-03-15T12:00:00.000Z
 * Returns null if no valid date pattern can be extracted.
 */
export function parseArchiveTimestamp(fileName: string): Date | null {
  // Pattern 1: _yYYYYmMM (e.g., PushNotificationLog_y2026m01)
  const yMmatch = /_y(\d{4})m(\d{2})/i.exec(fileName);
  if (yMmatch) {
    const year = parseInt(yMmatch[1], 10);
    const month = parseInt(yMmatch[2], 10);
    if (month >= 1 && month <= 12) {
      return new Date(Date.UTC(year, month - 1, 1));
    }
  }

  // Pattern 2: YYYY_MM or YYYY-MM (e.g., TelemetryRecord_2026_10 or telemetry-records-2026-10)
  const ymDelimMatch = /(\d{4})[-_](\d{2})(?![-_\d])/i.exec(fileName);
  if (ymDelimMatch) {
    const year = parseInt(ymDelimMatch[1], 10);
    const month = parseInt(ymDelimMatch[2], 10);
    if (month >= 1 && month <= 12) {
      return new Date(Date.UTC(year, month - 1, 1));
    }
  }

  // Pattern 3: YYYYMMDD_HHMMSS or YYYYMMDD
  const dateCompactMatch = /(\d{4})(\d{2})(\d{2})(?:_(\d{2})(\d{2})(\d{2}))?/i.exec(fileName);
  if (dateCompactMatch) {
    const year = parseInt(dateCompactMatch[1], 10);
    const month = parseInt(dateCompactMatch[2], 10);
    const day = parseInt(dateCompactMatch[3], 10);
    const hour = dateCompactMatch[4] ? parseInt(dateCompactMatch[4], 10) : 0;
    const min = dateCompactMatch[5] ? parseInt(dateCompactMatch[5], 10) : 0;
    const sec = dateCompactMatch[6] ? parseInt(dateCompactMatch[6], 10) : 0;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month - 1, day, hour, min, sec));
      if (!isNaN(d.getTime())) return d;
    }
  }

  return null;
}

/**
 * Redacts credentials (passwords, auth tokens) from database connection strings or messages.
 */
export function sanitizeConnectionUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    if (u.password) {
      u.password = "******";
    }
    return u.toString();
  } catch {
    return urlStr.replace(/:([^@/:]+)@/, ":******@");
  }
}

/**
 * Checks whether a database connection URL is strictly safe for disposable/test operations.
 * Fails loudly on production-like databases.
 */
export function assertSafeDisposableDatabaseUrl(databaseUrl: string): {
  databaseName: string;
  adminUrl: string;
} {
  if (!databaseUrl || typeof databaseUrl !== "string") {
    throw new Error("DATABASE_URL is not provided or empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Invalid PostgreSQL connection URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "");

  // Block obvious cloud / managed production endpoints
  const forbiddenHosts = [
    "rds.amazonaws.com",
    "supabase.co",
    "supabase.com",
    "neon.tech",
    "pooler.supabase.com",
    "cockroachlabs.cloud",
    "render.com",
    "railway.app",
    "cloudsql",
  ];

  for (const fh of forbiddenHosts) {
    if (hostname.endsWith(fh)) {
      throw new Error(
        `Safety safeguard triggered: Target host '${hostname}' appears to be a managed cloud database. Isolated restore drills are strictly forbidden against production/cloud endpoints.`,
      );
    }
  }

  // Target database name checks: Must not be production, staging, main, or live operational db
  const forbiddenDbNames = [
    "production",
    "prod",
    "staging",
    "live",
    "worksphere",
    "worksphere_prod",
    "worksphere_production",
    "worksphere_live",
  ];

  if (forbiddenDbNames.includes(dbName.toLowerCase())) {
    throw new Error(
      `Safety safeguard triggered: Target database name '${dbName}' is protected. Restore drills must target a test or disposable database.`,
    );
  }

  // Must match safe local / test pattern or contain test / drill / temp
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "postgres" ||
    hostname === "test-postgres";

  const isExplicitTestName =
    dbName.includes("test") ||
    dbName.includes("drill") ||
    dbName.includes("temp") ||
    dbName.includes("disposable") ||
    dbName.startsWith("worksphere_dev");

  if (!isExplicitTestName) {
    throw new Error(
      `Safety safeguard triggered: Target database '${dbName}' is not explicitly designated for test or restore drills. Database name must include 'test', 'drill', 'temp', 'disposable', or start with 'worksphere_dev'.`,
    );
  }

  if (!isLocal) {
    throw new Error(
      `Safety safeguard triggered: Remote host '${hostname}' is not recognized as a local disposable test host. Restore drills must target a local or isolated container service (localhost/127.0.0.1/postgres).`,
    );
  }

  // Build admin connection URL (connecting to 'postgres' maintenance db)
  const adminParsed = new URL(databaseUrl);
  adminParsed.pathname = "/postgres";

  return {
    databaseName: dbName,
    adminUrl: adminParsed.toString(),
  };
}

/**
 * Escapes an SQL identifier safely.
 */
export function escapeIdentifier(ident: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(ident)) {
    throw new Error(`Unsafe SQL identifier: ${ident}`);
  }
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Decompresses an archive with bounded memory to prevent runaway memory usage / zip bombs.
 */
export function decompressArchiveBounded(
  buffer: Buffer,
  maxSizeBytes: number = DEFAULT_MAX_UNCOMPRESSED_SIZE_BYTES,
): string {
  const uncompressedBuffer = zlib.gunzipSync(buffer, {
    maxOutputLength: maxSizeBytes,
  });
  return uncompressedBuffer.toString("utf-8");
}

/**
 * Verifies an individual partition backup archive file.
 */
export function verifyPartitionArchive(
  filePath: string,
  options: ArchiveCoverageConfig = {},
): PartitionBackupReport {
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

  // 3. Decompress and verify SQL integrity (with bounded memory limit)
  let decompressedSql: string;
  let uncompressedSizeBytes: number;
  const maxUncompressed = options.maxUncompressedSizeBytes || DEFAULT_MAX_UNCOMPRESSED_SIZE_BYTES;
  try {
    decompressedSql = decompressArchiveBounded(buffer, maxUncompressed);
    uncompressedSizeBytes = Buffer.byteLength(decompressedSql, "utf-8");

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

  // 4. Archive Freshness / Stale Check
  const archiveDate = parseArchiveTimestamp(fileName);
  let isStale = false;
  if (options.maxAgeMs !== undefined && options.maxAgeMs > 0) {
    const now = options.now ? options.now() : new Date();
    if (archiveDate) {
      const ageMs = now.getTime() - archiveDate.getTime();
      if (ageMs > options.maxAgeMs) {
        isStale = true;
      }
    } else {
      // If timestamp cannot be parsed from name, fall back to file mtime
      const ageMs = now.getTime() - stats.mtime.getTime();
      if (ageMs > options.maxAgeMs) {
        isStale = true;
      }
    }
  }

  if (isStale) {
    return {
      fileName,
      partitionName,
      filePath,
      fileSizeBytes,
      status: "STALE",
      hasGzipMagicBytes: true,
      checksumMatched,
      expectedChecksum: expectedChecksum ?? undefined,
      actualChecksum,
      uncompressedSizeBytes,
      archiveTimestamp: archiveDate ? archiveDate.toISOString() : stats.mtime.toISOString(),
      isStale: true,
      errorMessage: `Archive is older than configured maximum age (${options.maxAgeMs}ms)`,
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
    archiveTimestamp: archiveDate ? archiveDate.toISOString() : undefined,
    isStale: false,
  };
}

/**
 * Splits SQL text into executable SQL statements respecting comments (-- and /* *\/),
 * dollar quotes, COPY stdin blocks, and single quotes.
 */
export function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let inDollarQuote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  let i = 0;
  while (i < sqlText.length) {
    const char = sqlText[i];
    const nextChar = sqlText[i + 1] || "";

    // 1. Line comment handling
    if (!inString && !inDollarQuote && !inBlockComment) {
      if (char === "-" && nextChar === "-") {
        inLineComment = true;
      }
      if (inLineComment) {
        if (char === "\n") {
          inLineComment = false;
        }
        current += char;
        i++;
        continue;
      }
    }

    // 2. Block comment handling
    if (!inString && !inDollarQuote && !inLineComment) {
      if (char === "/" && nextChar === "*") {
        inBlockComment = true;
      }
      if (inBlockComment) {
        if (char === "*" && nextChar === "/") {
          inBlockComment = false;
          current += "*/";
          i += 2;
          continue;
        }
        current += char;
        i++;
        continue;
      }
    }

    // 3. Dollar-quoting: e.g. $$ or $tag$
    if (!inString && !inDollarQuote && char === "$") {
      const remainder = sqlText.slice(i);
      const dollarMatch = /^\$[a-zA-Z0-9_]*\$/.exec(remainder);
      if (dollarMatch) {
        inDollarQuote = dollarMatch[0];
        current += inDollarQuote;
        i += inDollarQuote.length;
        continue;
      }
    } else if (inDollarQuote && char === "$") {
      const remainder = sqlText.slice(i);
      if (remainder.startsWith(inDollarQuote)) {
        current += inDollarQuote;
        i += inDollarQuote.length;
        inDollarQuote = null;
        continue;
      }
    }

    // 4. String and Statement boundary
    if (!inDollarQuote) {
      if (char === "'") {
        if (inString && nextChar === "'") {
          current += "''";
          i += 2;
          continue;
        }
        inString = !inString;
      } else if (char === ";" && !inString) {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
          statements.push(trimmed);
        }
        current = "";
        i++;
        continue;
      }
    }

    current += char;
    i++;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }

  return statements;
}

/**
 * Executes an isolated PostgreSQL restore smoke test for an archive.
 * Restores into a dynamically created disposable database, validates schema & records,
 * and ensures complete cleanup in all paths (success, error, timeout).
 */
export async function executeRestoreDrill(
  archiveFilePath: string,
  config: ArchiveCoverageConfig,
): Promise<{
  success: boolean;
  validatedTables: string[];
  errorMessage?: string;
}> {
  if (!config.restoreDatabaseUrl) {
    throw new Error("Cannot execute restore drill: restoreDatabaseUrl is not configured.");
  }

  const { adminUrl } = assertSafeDisposableDatabaseUrl(config.restoreDatabaseUrl);
  const drillId = crypto.randomBytes(4).toString("hex");
  const tempDbName = `ws_drill_${Date.now()}_${drillId}`;
  const validatedTables: string[] = [];

  const createClient = (connStr: string) => {
    if (config.pgClientFactory) {
      return config.pgClientFactory({ connectionString: connStr });
    }
    return new Client({ connectionString: connStr });
  };

  const adminClient = createClient(adminUrl);
  let drillClient: Client | null = null;
  let isDbCreated = false;

  // Read and decompress archive
  let sqlContent: string;
  try {
    const rawBuffer = fs.readFileSync(archiveFilePath);
    sqlContent = decompressArchiveBounded(
      rawBuffer,
      config.maxUncompressedSizeBytes || DEFAULT_MAX_UNCOMPRESSED_SIZE_BYTES,
    );
  } catch (err) {
    return {
      success: false,
      validatedTables: [],
      errorMessage: `Failed to prepare archive for restore drill: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    await adminClient.connect();

    // 1. Create disposable database
    await adminClient.query(`CREATE DATABASE ${escapeIdentifier(tempDbName)}`);
    isDbCreated = true;

    // Connect to disposable database
    const drillUrl = new URL(adminUrl);
    drillUrl.pathname = `/${tempDbName}`;
    drillClient = createClient(drillUrl.toString());
    await drillClient.connect();

    // 2. Install required PostgreSQL extensions
    const extensions = config.requiredExtensions || DEFAULT_REQUIRED_EXTENSIONS;
    for (const ext of extensions) {
      try {
        await drillClient.query(`CREATE EXTENSION IF NOT EXISTS ${escapeIdentifier(ext)}`);
      } catch (extErr) {
        throw new Error(
          `Failed to enable required extension '${ext}': ${extErr instanceof Error ? extErr.message : String(extErr)}`,
        );
      }
    }

    // Verify extensions are installed
    const extCheckRes = await drillClient.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = ANY($1)`,
      [extensions],
    );
    const installedExtNames = new Set(extCheckRes.rows.map((r) => r.extname));
    for (const ext of extensions) {
      if (!installedExtNames.has(ext)) {
        throw new Error(`Required extension '${ext}' was not found in pg_extension after installation.`);
      }
    }

    const statements = splitSqlStatements(sqlContent);
    const timeoutMs = config.restoreTimeoutMs || DEFAULT_RESTORE_TIMEOUT_MS;

    let timeoutId: NodeJS.Timeout | undefined;
    let didTimeout = false;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        didTimeout = true;
        reject(new Error(`Restore drill timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timeoutId.unref === "function") {
        timeoutId.unref();
      }
    });

    const restorePromise = (async () => {
      for (const statement of statements) {
        if (didTimeout) {
          throw new Error(`Restore drill aborted due to timeout`);
        }
        // Skip psql meta-commands or empty comments if any
        if (statement.startsWith("\\")) continue;
        await drillClient!.query(statement);
      }
    })();

    try {
      await Promise.race([restorePromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    // 4. Validate recovered schema and records
    // Query all user tables in the disposable database
    const tableRes = await drillClient.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`,
    );
    const existingTables = new Set(tableRes.rows.map((r) => r.tablename));

    const partitionBaseName = extractPartitionName(path.basename(archiveFilePath));

    // If specific table validations were provided, assert them
    if (config.tableValidations) {
      for (const [key, val] of Object.entries(config.tableValidations)) {
        if (partitionBaseName.toLowerCase().includes(key.toLowerCase()) || key === "*") {
          const targetTable = val.tableName;
          if (!existingTables.has(targetTable)) {
            throw new Error(`Recovered database validation failed: Expected table '${targetTable}' does not exist.`);
          }
          validatedTables.push(targetTable);

          if (val.minRowCount !== undefined && val.minRowCount > 0) {
            const countRes = await drillClient.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM ${escapeIdentifier(targetTable)}`,
            );
            const count = parseInt(countRes.rows[0]?.count || "0", 10);
            if (count < val.minRowCount) {
              throw new Error(
                `Recovered table '${targetTable}' row count invariant failed: expected at least ${val.minRowCount} rows, found ${count}.`,
              );
            }
          }
        }
      }
    }

    // If no custom table validations configured, verify at least one table was restored
    if (validatedTables.length === 0) {
      if (existingTables.size === 0) {
        throw new Error("Recovered database validation failed: No user tables were created by the archive dump.");
      }
      validatedTables.push(...Array.from(existingTables));
    }

    return {
      success: true,
      validatedTables,
    };
  } catch (drillError) {
    return {
      success: false,
      validatedTables,
      errorMessage: drillError instanceof Error ? drillError.message : String(drillError),
    };
  } finally {
    // Robust cleanup: Always close drill connection and drop disposable db
    if (drillClient) {
      try {
        await drillClient.end();
      } catch {
        // Ignore client close errors during cleanup
      }
    }

    if (isDbCreated) {
      try {
        // Disconnect any lingering sessions and drop the temporary database with force
        await adminClient.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [tempDbName],
        );
        await adminClient.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(tempDbName)} WITH (FORCE)`);
      } catch {
        // Best effort db cleanup
      }
    }

    try {
      await adminClient.end();
    } catch {
      // Ignore admin client close errors
    }
  }
}

/**
 * Checks archive coverage against expected partitions.
 * Missing expected partitions are reported as errors when coverage is required.
 */
export function checkArchiveCoverage(
  reports: PartitionBackupReport[],
  config: ArchiveCoverageConfig,
): { missingExpectedArchives: string[]; coveragePassed: boolean } {
  const missingExpectedArchives: string[] = [];
  const expected = config.expectedPartitions || [];

  if (expected.length === 0) {
    return { missingExpectedArchives: [], coveragePassed: true };
  }

  const foundNames = reports.map((r) => r.fileName);
  const foundPartitions = reports.map((r) => r.partitionName);

  for (const exp of expected) {
    const matched =
      foundNames.some((fn) => fn === exp || fn.includes(exp)) ||
      foundPartitions.some((pn) => pn === exp || pn.includes(exp));
    if (!matched) {
      missingExpectedArchives.push(exp);
    }
  }

  const coveragePassed = missingExpectedArchives.length === 0;
  return { missingExpectedArchives, coveragePassed };
}

/**
 * Scans a directory for partition backup archives, runs verification checks,
 * performs freshness checks, and optionally executes restore drills.
 */
export async function scanAndVerifyBackupsAsync(
  targetDirectory: string,
  options: ArchiveCoverageConfig & { filePattern?: RegExp } = {},
): Promise<VerificationSummary> {
  const filePattern = options.filePattern || /\.(sql\.gz|gz)$/i;
  const requireCoverage = options.requireCoverage ?? true;
  const reports: PartitionBackupReport[] = [];
  const errors: string[] = [];

  // Check directory existence
  if (!fs.existsSync(targetDirectory)) {
    if (requireCoverage) {
      errors.push(`Partition backup directory does not exist: ${targetDirectory}`);
    }
    return {
      scannedDirectory: targetDirectory,
      totalArchives: 0,
      validArchives: 0,
      corruptedArchives: 0,
      zeroByteArchives: 0,
      staleArchives: 0,
      restoreFailedArchives: 0,
      missingExpectedArchives: options.expectedPartitions || [],
      coveragePassed: !requireCoverage,
      restoreDrillPassed: true,
      timestamp: (options.now ? options.now() : new Date()).toISOString(),
      reports: [],
      errors,
    };
  }

  const entries = fs.readdirSync(targetDirectory);
  for (const entry of entries) {
    // Only scan archives matching pattern, skip checksum files
    if (filePattern.test(entry) && !entry.endsWith(".sha256")) {
      const fullPath = path.join(targetDirectory, entry);
      if (fs.statSync(fullPath).isFile()) {
        const report = verifyPartitionArchive(fullPath, options);
        reports.push(report);
      }
    }
  }

  // Check for empty archive directory when coverage is required
  if (reports.length === 0 && requireCoverage) {
    errors.push(`No partition backup archives found in directory: ${targetDirectory} (coverage required)`);
  }

  // Check expected partitions coverage
  const { missingExpectedArchives, coveragePassed } = checkArchiveCoverage(reports, options);
  if (!coveragePassed && requireCoverage) {
    errors.push(
      `Missing required partition archives: ${missingExpectedArchives.join(", ")}`,
    );
  }

  let restoreDrillPassed = true;

  // If isolated restore validation is configured, execute restore drill for valid archives
  if (options.restoreDatabaseUrl && reports.length > 0) {
    for (const report of reports) {
      if (report.status === "VALID") {
        const drillResult = await executeRestoreDrill(report.filePath, options);
        if (!drillResult.success) {
          report.status = "RESTORE_FAILED";
          report.restoredSuccessfully = false;
          report.errorMessage = drillResult.errorMessage;
          restoreDrillPassed = false;
        } else {
          report.restoredSuccessfully = true;
          report.validatedTables = drillResult.validatedTables;
        }
      }
    }
  }

  const validArchives = reports.filter((r) => r.status === "VALID").length;
  const zeroByteArchives = reports.filter((r) => r.status === "ZERO_BYTE").length;
  const staleArchives = reports.filter((r) => r.status === "STALE").length;
  const restoreFailedArchives = reports.filter((r) => r.status === "RESTORE_FAILED").length;
  const corruptedArchives = reports.filter(
    (r) =>
      r.status !== "VALID" &&
      r.status !== "ZERO_BYTE" &&
      r.status !== "STALE" &&
      r.status !== "RESTORE_FAILED",
  ).length;

  return {
    scannedDirectory: targetDirectory,
    totalArchives: reports.length,
    validArchives,
    corruptedArchives,
    zeroByteArchives,
    staleArchives,
    restoreFailedArchives,
    missingExpectedArchives,
    coveragePassed: requireCoverage ? coveragePassed && reports.length > 0 : true,
    restoreDrillPassed,
    timestamp: (options.now ? options.now() : new Date()).toISOString(),
    reports,
    errors,
  };
}

/**
 * Synchronous backward-compatible scan wrapper.
 */
export function scanAndVerifyBackups(
  targetDirectory: string,
  options: ArchiveCoverageConfig & { filePattern?: RegExp } = {},
): VerificationSummary {
  const filePattern = options.filePattern || /\.(sql\.gz|gz)$/i;
  const requireCoverage = options.requireCoverage ?? false;
  const reports: PartitionBackupReport[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(targetDirectory)) {
    if (requireCoverage) {
      errors.push(`Partition backup directory does not exist: ${targetDirectory}`);
    }
    return {
      scannedDirectory: targetDirectory,
      totalArchives: 0,
      validArchives: 0,
      corruptedArchives: 0,
      zeroByteArchives: 0,
      staleArchives: 0,
      restoreFailedArchives: 0,
      missingExpectedArchives: options.expectedPartitions || [],
      coveragePassed: !requireCoverage,
      restoreDrillPassed: true,
      timestamp: (options.now ? options.now() : new Date()).toISOString(),
      reports: [],
      errors,
    };
  }

  const entries = fs.readdirSync(targetDirectory);
  for (const entry of entries) {
    if (filePattern.test(entry) && !entry.endsWith(".sha256")) {
      const fullPath = path.join(targetDirectory, entry);
      if (fs.statSync(fullPath).isFile()) {
        reports.push(verifyPartitionArchive(fullPath, options));
      }
    }
  }

  const { missingExpectedArchives, coveragePassed } = checkArchiveCoverage(reports, options);
  if (!coveragePassed && requireCoverage) {
    errors.push(
      `Missing required partition archives: ${missingExpectedArchives.join(", ")}`,
    );
  }

  const validArchives = reports.filter((r) => r.status === "VALID").length;
  const zeroByteArchives = reports.filter((r) => r.status === "ZERO_BYTE").length;
  const staleArchives = reports.filter((r) => r.status === "STALE").length;
  const corruptedArchives = reports.filter(
    (r) =>
      r.status !== "VALID" &&
      r.status !== "ZERO_BYTE" &&
      r.status !== "STALE" &&
      r.status !== "RESTORE_FAILED",
  ).length;

  return {
    scannedDirectory: targetDirectory,
    totalArchives: reports.length,
    validArchives,
    corruptedArchives,
    zeroByteArchives,
    staleArchives,
    restoreFailedArchives: 0,
    missingExpectedArchives,
    coveragePassed: requireCoverage ? coveragePassed && reports.length > 0 : true,
    restoreDrillPassed: true,
    timestamp: (options.now ? options.now() : new Date()).toISOString(),
    reports,
    errors,
  };
}

/**
 * Formats a terminal-friendly table report.
 */
export function formatSummaryConsole(summary: VerificationSummary): void {
  console.log("\n=======================================================");
  console.log("       WorkSphere Partition Backup Verification       ");
  console.log("=======================================================");
  console.log(`Directory:        ${summary.scannedDirectory}`);
  console.log(`Scanned At:       ${summary.timestamp}`);
  console.log(`Total Files:      ${summary.totalArchives}`);
  console.log(`Valid:            ${summary.validArchives}`);
  console.log(`Zero-Byte:        ${summary.zeroByteArchives}`);
  console.log(`Stale:            ${summary.staleArchives}`);
  console.log(`Restore Failed:   ${summary.restoreFailedArchives}`);
  console.log(`Corrupted:        ${summary.corruptedArchives}`);
  console.log(`Coverage Passed:  ${summary.coveragePassed ? "YES" : "NO"}`);
  console.log(`Restore Passed:   ${summary.restoreDrillPassed ? "YES" : "NO"}`);
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
            : report.status === "STALE"
              ? "[STALE]"
              : report.status === "RESTORE_FAILED"
                ? "[RESTORE_FAIL]"
                : "[CORRUPTED]";
      console.log(
        `${badge.padEnd(14)} ${report.fileName} (${(report.fileSizeBytes / 1024).toFixed(2)} KB) -> Status: ${report.status}`,
      );
      if (report.errorMessage) {
        console.log(`               Reason: ${report.errorMessage}`);
      }
      if (report.actualChecksum) {
        console.log(`               SHA256: ${report.actualChecksum}`);
      }
      if (report.validatedTables && report.validatedTables.length > 0) {
        console.log(`               Tables: ${report.validatedTables.join(", ")}`);
      }
    }
  }

  if (summary.errors.length > 0) {
    console.log("-------------------------------------------------------");
    for (const err of summary.errors) {
      console.log(`[COVERAGE ERROR] ${err}`);
    }
  }
  console.log("=======================================================\n");
}

/**
 * Command line entrypoint when executed directly.
 */
export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const targetDir =
    args[0] ||
    process.env.PARTITION_BACKUP_DIR ||
    path.join(process.cwd(), "backups", "partitions");

  const requireCoverage =
    process.env.PARTITION_BACKUP_REQUIRE_COVERAGE !== undefined
      ? process.env.PARTITION_BACKUP_REQUIRE_COVERAGE === "true" ||
        process.env.PARTITION_BACKUP_REQUIRE_COVERAGE === "1"
      : true;

  const expectedPartitions = process.env.PARTITION_BACKUP_EXPECTED
    ? process.env.PARTITION_BACKUP_EXPECTED.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const maxAgeHours = process.env.PARTITION_BACKUP_MAX_AGE_HOURS
    ? parseFloat(process.env.PARTITION_BACKUP_MAX_AGE_HOURS)
    : undefined;

  const maxAgeMs = maxAgeHours && !isNaN(maxAgeHours) ? maxAgeHours * 60 * 60 * 1000 : undefined;

  const restoreDatabaseUrl = process.env.PARTITION_TEST_DATABASE_URL;

  console.log(`Starting partition backup verification on: ${targetDir}`);
  if (restoreDatabaseUrl) {
    console.log(`Isolated PostgreSQL restore drill enabled against verified disposable target.`);
  }

  const summary = await scanAndVerifyBackupsAsync(targetDir, {
    requireCoverage,
    expectedPartitions,
    maxAgeMs,
    restoreDatabaseUrl,
  });

  formatSummaryConsole(summary);

  const hasFailures =
    summary.zeroByteArchives > 0 ||
    summary.corruptedArchives > 0 ||
    summary.staleArchives > 0 ||
    summary.restoreFailedArchives > 0 ||
    !summary.coveragePassed ||
    !summary.restoreDrillPassed ||
    summary.errors.length > 0;

  if (hasFailures) {
    console.error(`[ALERT] Partition backup verification failed!`);
    process.exit(1);
  }

  console.log("[SUCCESS] All scanned partition backup archives passed verification and restore drills.");
  process.exit(0);
}

// Execute when invoked directly
if (typeof process !== "undefined" && process.argv[1]) {
  const currentFilePath = path.resolve(process.argv[1]);
  const isDirectRun =
    currentFilePath.endsWith("verify-partition-backups.ts") ||
    currentFilePath.endsWith("verify-partition-backups.js");

  if (isDirectRun) {
    runCli().catch((err) => {
      console.error("[FATAL ERROR]", err);
      process.exit(1);
    });
  }
}
