/**
 * @jest-environment node
 *
 * Tests for Partition-Backup Restore Drills and Archive-Coverage Checks (Issue #8443).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {
  validateSqlDumpStructure,
  parseArchiveTimestamp,
  sanitizeConnectionUrl,
  assertSafeDisposableDatabaseUrl,
  escapeIdentifier,
  decompressArchiveBounded,
  verifyPartitionArchive,
  splitSqlStatements,
  executeRestoreDrill,
  checkArchiveCoverage,
  scanAndVerifyBackupsAsync,
} from "../../../scripts/verify-partition-backups";

describe("Partition Backup Verification & Restore Drills (Issue #8443)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-backup-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  function createArchive(
    fileName: string,
    sqlContent: string,
    options: { corruptGzip?: boolean; addChecksumFile?: boolean; wrongChecksum?: boolean } = {},
  ): string {
    const filePath = path.join(tempDir, fileName);
    let buffer: Buffer;

    if (options.corruptGzip) {
      buffer = Buffer.from("NOT_A_VALID_GZIP_ARCHIVE_DATA");
    } else {
      buffer = zlib.gzipSync(Buffer.from(sqlContent, "utf-8"));
    }

    fs.writeFileSync(filePath, buffer);

    if (options.addChecksumFile) {
      const checksum = options.wrongChecksum
        ? "0000000000000000000000000000000000000000000000000000000000000000"
        : crypto.createHash("sha256").update(buffer).digest("hex");
      fs.writeFileSync(`${filePath}.sha256`, checksum);
    }

    return filePath;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ARCHIVE DISCOVERY AND COVERAGE TESTS
  // ───────────────────────────────────────────────────────────────────────────

  describe("Archive Discovery and Coverage", () => {
    it("1. Missing backup directory fails when coverage is required", async () => {
      const missingDir = path.join(tempDir, "non_existent_backups_dir");
      const summary = await scanAndVerifyBackupsAsync(missingDir, { requireCoverage: true });
      expect(summary.totalArchives).toBe(0);
      expect(summary.coveragePassed).toBe(false);
      expect(summary.errors.length).toBeGreaterThan(0);
      expect(summary.errors[0]).toContain("does not exist");
    });

    it("2. Empty archive directory fails when coverage is required", async () => {
      const summary = await scanAndVerifyBackupsAsync(tempDir, { requireCoverage: true });
      expect(summary.totalArchives).toBe(0);
      expect(summary.coveragePassed).toBe(false);
      expect(summary.errors.some((e) => e.includes("coverage required"))).toBe(true);
    });

    it("3. Valid empty result when explicitly permitted (requireCoverage: false)", async () => {
      const summary = await scanAndVerifyBackupsAsync(tempDir, { requireCoverage: false });
      expect(summary.totalArchives).toBe(0);
      expect(summary.coveragePassed).toBe(true);
      expect(summary.errors.length).toBe(0);
    });

    it("4. Missing expected archive fails coverage", async () => {
      createArchive("PushNotificationLog_y2026m01.sql.gz", "CREATE TABLE t (id text);");
      const summary = await scanAndVerifyBackupsAsync(tempDir, {
        requireCoverage: true,
        expectedPartitions: ["PushNotificationLog", "TelemetryRecord"],
      });
      expect(summary.coveragePassed).toBe(false);
      expect(summary.missingExpectedArchives).toEqual(["TelemetryRecord"]);
      expect(summary.errors.some((e) => e.includes("TelemetryRecord"))).toBe(true);
    });

    it("5. Incomplete archive coverage reports all missing partitions", () => {
      const reports = [
        {
          fileName: "PushNotificationLog_y2026m01.sql.gz",
          partitionName: "PushNotificationLog_y2026m01",
          filePath: "/p1",
          fileSizeBytes: 100,
          status: "VALID" as const,
          hasGzipMagicBytes: true,
          checksumMatched: true,
        },
      ];
      const result = checkArchiveCoverage(reports, {
        expectedPartitions: ["PushNotificationLog", "TelemetryRecord", "WifiTelemetry"],
      });
      expect(result.coveragePassed).toBe(false);
      expect(result.missingExpectedArchives).toEqual(["TelemetryRecord", "WifiTelemetry"]);
    });

    it("6. Stale archive detection against configured max age", async () => {
      createArchive(
        "PushNotificationLog_y2026m01.sql.gz",
        "CREATE TABLE test (id text);",
      );
      const freezeTime = new Date("2026-06-01T00:00:00.000Z"); // ~5 months later
      const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days

      const summary = await scanAndVerifyBackupsAsync(tempDir, {
        requireCoverage: true,
        maxAgeMs,
        now: () => freezeTime,
      });

      expect(summary.totalArchives).toBe(1);
      expect(summary.staleArchives).toBe(1);
      expect(summary.reports[0].status).toBe("STALE");
      expect(summary.reports[0].isStale).toBe(true);
      expect(summary.reports[0].errorMessage).toContain("older than configured maximum age");
    });

    it("7. Fresh archive within configured max age passes", async () => {
      createArchive(
        "PushNotificationLog_y2026m05.sql.gz",
        "CREATE TABLE test (id text);",
      );
      const freezeTime = new Date("2026-05-15T00:00:00.000Z");
      const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days

      const summary = await scanAndVerifyBackupsAsync(tempDir, {
        requireCoverage: true,
        maxAgeMs,
        now: () => freezeTime,
      });

      expect(summary.totalArchives).toBe(1);
      expect(summary.staleArchives).toBe(0);
      expect(summary.reports[0].status).toBe("VALID");
    });

    it("8. Invalid archive naming or timestamp falls back safely", () => {
      expect(parseArchiveTimestamp("PushNotificationLog_y2026m01.sql.gz")).toEqual(
        new Date(Date.UTC(2026, 0, 1)),
      );
      expect(parseArchiveTimestamp("TelemetryRecord_2026_10.sql.gz")).toEqual(
        new Date(Date.UTC(2026, 9, 1)),
      );
      expect(parseArchiveTimestamp("telemetry-records-2026-10.sql.gz")).toEqual(
        new Date(Date.UTC(2026, 9, 1)),
      );
      expect(parseArchiveTimestamp("custom_backup_20260315_120000.sql.gz")).toEqual(
        new Date(Date.UTC(2026, 2, 15, 12, 0, 0)),
      );
      expect(parseArchiveTimestamp("random_file_without_date.sql.gz")).toBeNull();
    });

    it("9. Malformed inventory configuration handled gracefully", async () => {
      const summary = await scanAndVerifyBackupsAsync(tempDir, {
        requireCoverage: false,
        expectedPartitions: [],
      });
      expect(summary.coveragePassed).toBe(true);
      expect(summary.missingExpectedArchives).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EXISTING ARCHIVE VERIFICATION PRESERVATION
  // ───────────────────────────────────────────────────────────────────────────

  describe("Archive Integrity & Checksum Verification", () => {
    it("10. Valid gzip archive passes integrity check", () => {
      const filePath = createArchive(
        "PushNotificationLog_y2026m01.sql.gz",
        "CREATE TABLE test (id text); INSERT INTO test VALUES ('ok');",
      );
      const report = verifyPartitionArchive(filePath);
      expect(report.status).toBe("VALID");
      expect(report.hasGzipMagicBytes).toBe(true);
      expect(report.uncompressedSizeBytes).toBeGreaterThan(0);
    });

    it("11. Corrupt gzip archive fails magic bytes check", () => {
      const filePath = createArchive("corrupted.sql.gz", "whatever", { corruptGzip: true });
      const report = verifyPartitionArchive(filePath);
      expect(report.status).toBe("INVALID_MAGIC_BYTES");
      expect(report.hasGzipMagicBytes).toBe(false);
      expect(report.errorMessage).toContain("Invalid gzip magic bytes");
    });

    it("12. Valid companion checksum matches", () => {
      const filePath = createArchive(
        "PushNotificationLog_y2026m01.sql.gz",
        "CREATE TABLE test (id text);",
        { addChecksumFile: true },
      );
      const report = verifyPartitionArchive(filePath);
      expect(report.status).toBe("VALID");
      expect(report.checksumMatched).toBe(true);
    });

    it("13. Checksum mismatch fails archive verification", () => {
      const filePath = createArchive(
        "PushNotificationLog_y2026m01.sql.gz",
        "CREATE TABLE test (id text);",
        { addChecksumFile: true, wrongChecksum: true },
      );
      const report = verifyPartitionArchive(filePath);
      expect(report.status).toBe("CHECKSUM_MISMATCH");
      expect(report.checksumMatched).toBe(false);
      expect(report.errorMessage).toContain("Checksum mismatch");
    });

    it("14. SQL structure validation passes on standard PostgreSQL keywords", () => {
      expect(validateSqlDumpStructure("CREATE TABLE my_part (id text);")).toBe(true);
      expect(validateSqlDumpStructure("COPY my_part (id) FROM stdin;\n1\n\\.")).toBe(true);
      expect(validateSqlDumpStructure("INSERT INTO my_part VALUES ('val');")).toBe(true);
      expect(validateSqlDumpStructure("ALTER TABLE my_part ADD PRIMARY KEY (id);")).toBe(true);
      expect(validateSqlDumpStructure("SET SCHEMA 'telemetry_archive';")).toBe(true);
    });

    it("15. Decompressed text lacking valid SQL statements is rejected", () => {
      const filePath = createArchive(
        "PushNotificationLog_y2026m01.sql.gz",
        "Hello World, this is random text without SQL keywords.",
      );
      const report = verifyPartitionArchive(filePath);
      expect(report.status).toBe("INVALID_SQL_STRUCTURE");
      expect(report.errorMessage).toContain("lacks valid SQL statements");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // DATABASE SAFETY AND URL SAFEGUARDS
  // ───────────────────────────────────────────────────────────────────────────

  describe("Database Safety Safeguards", () => {
    it("Redacts credentials in connection URLs", () => {
      const raw = "postgresql://user:super_secret_pw@localhost:5432/worksphere_test";
      const sanitized = sanitizeConnectionUrl(raw);
      expect(sanitized).not.toContain("super_secret_pw");
      expect(sanitized).toContain("******");
    });

    it("Rejects production / cloud hostnames", () => {
      const prodUrl = "postgresql://user:pass@db.prod.rds.amazonaws.com:5432/testdb";
      expect(() => assertSafeDisposableDatabaseUrl(prodUrl)).toThrow(
        /appears to be a managed cloud database/,
      );

      const supabaseUrl = "postgresql://user:pass@db.supabase.co:5432/testdb";
      expect(() => assertSafeDisposableDatabaseUrl(supabaseUrl)).toThrow(
        /appears to be a managed cloud database/,
      );
    });

    it("Rejects protected database names", () => {
      const prodDb = "postgresql://user:pass@localhost:5432/worksphere_prod";
      expect(() => assertSafeDisposableDatabaseUrl(prodDb)).toThrow(
        /is protected/,
      );

      const mainDb = "postgresql://user:pass@localhost:5432/worksphere";
      expect(() => assertSafeDisposableDatabaseUrl(mainDb)).toThrow(
        /is protected/,
      );
    });

    it("Allows safe local test databases", () => {
      const testUrl = "postgresql://worksphere:pass@localhost:5432/worksphere_test";
      const { databaseName, adminUrl } = assertSafeDisposableDatabaseUrl(testUrl);
      expect(databaseName).toBe("worksphere_test");
      expect(adminUrl).toContain("/postgres");
    });

    it("Rejects unsafe SQL identifiers to prevent injection", () => {
      expect(() => escapeIdentifier('evil_table"; DROP TABLE "User')).toThrow(/Unsafe SQL identifier/);
      expect(escapeIdentifier("safe_table_name_123")).toBe('"safe_table_name_123"');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RESTORE DRILL EXECUTION AND RESOURCE MANAGEMENT (MOCKED PG CLIENT)
  // ───────────────────────────────────────────────────────────────────────────

  describe("Restore Drill Logic & Mock Client", () => {
    it("16. Successful isolated restoration & table validation with cleanup", async () => {
      const sql = `
        CREATE TABLE "PushNotificationLog_y2026m01" (
          "id" text PRIMARY KEY,
          "userId" text NOT NULL,
          "createdAt" timestamp NOT NULL
        );
        INSERT INTO "PushNotificationLog_y2026m01" ("id", "userId", "createdAt")
        VALUES ('log_1', 'user_1', '2026-01-15 12:00:00');
      `;
      const filePath = createArchive("PushNotificationLog_y2026m01.sql.gz", sql);

      const executedQueries: string[] = [];
      let dbCreated = false;
      let dbDropped = false;
      let clientClosed = false;

      const mockClient = (config: any) => {
        const _connStr = typeof config === "string" ? config : config?.connectionString || "";
        return {
          connect: jest.fn(async () => {}),
          query: jest.fn(async (q: string, _params?: any[]) => {
            executedQueries.push(q);
            if (q.startsWith("CREATE DATABASE")) {
              dbCreated = true;
              return { rows: [] };
            }
            if (q.includes("DROP DATABASE")) {
              dbDropped = true;
              return { rows: [] };
            }
            if (q.includes("pg_extension")) {
              return { rows: [{ extname: "vector" }, { extname: "pg_trgm" }, { extname: "postgis" }] };
            }
            if (q.includes("pg_tables")) {
              return { rows: [{ tablename: "PushNotificationLog_y2026m01" }] };
            }
            if (q.includes("count(*)")) {
              return { rows: [{ count: "1" }] };
            }
            return { rows: [] };
          }),
          end: jest.fn(async () => {
            clientClosed = true;
          }),
        } as any;
      };

      const result = await executeRestoreDrill(filePath, {
        restoreDatabaseUrl: "postgresql://user:pw@localhost:5432/ws_test_db",
        pgClientFactory: mockClient,
        tableValidations: {
          PushNotificationLog: {
            tableName: "PushNotificationLog_y2026m01",
            minRowCount: 1,
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.validatedTables).toContain("PushNotificationLog_y2026m01");
      expect(dbCreated).toBe(true);
      expect(dbDropped).toBe(true);
      expect(clientClosed).toBe(true);
    });

    it("17. Failed restoration query reports failure and cleans up temporary db", async () => {
      const sql = "CREATE TABLE test (id text); SYNTAX ERROR HERE;";
      const filePath = createArchive("PushNotificationLog_y2026m01.sql.gz", sql);

      let dbDropped = false;

      const mockClient = (_config: any) => {
        return {
          connect: jest.fn(async () => {}),
          query: jest.fn(async (q: string) => {
            if (q.startsWith("CREATE DATABASE")) return { rows: [] };
            if (q.includes("DROP DATABASE")) {
              dbDropped = true;
              return { rows: [] };
            }
            if (q.includes("pg_extension")) {
              return { rows: [{ extname: "vector" }, { extname: "pg_trgm" }, { extname: "postgis" }] };
            }
            if (q.includes("SYNTAX ERROR")) {
              throw new Error("syntax error at or near SYNTAX");
            }
            return { rows: [] };
          }),
          end: jest.fn(async () => {}),
        } as any;
      };

      const result = await executeRestoreDrill(filePath, {
        restoreDatabaseUrl: "postgresql://user:pw@localhost:5432/ws_test_db",
        pgClientFactory: mockClient,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("syntax error");
      expect(dbDropped).toBe(true);
    });

    it("18. Missing expected table after restoration fails validation and cleans up", async () => {
      const sql = "CREATE TABLE unexpected_table (id text);";
      const filePath = createArchive("PushNotificationLog_y2026m01.sql.gz", sql);

      let dbDropped = false;

      const mockClient = (_config: any) => {
        return {
          connect: jest.fn(async () => {}),
          query: jest.fn(async (q: string) => {
            if (q.startsWith("CREATE DATABASE")) return { rows: [] };
            if (q.includes("DROP DATABASE")) {
              dbDropped = true;
              return { rows: [] };
            }
            if (q.includes("pg_extension")) {
              return { rows: [{ extname: "vector" }, { extname: "pg_trgm" }, { extname: "postgis" }] };
            }
            if (q.includes("pg_tables")) {
              return { rows: [{ tablename: "unexpected_table" }] };
            }
            return { rows: [] };
          }),
          end: jest.fn(async () => {}),
        } as any;
      };

      const result = await executeRestoreDrill(filePath, {
        restoreDatabaseUrl: "postgresql://user:pw@localhost:5432/ws_test_db",
        pgClientFactory: mockClient,
        tableValidations: {
          PushNotificationLog: {
            tableName: "PushNotificationLog_y2026m01",
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Expected table 'PushNotificationLog_y2026m01' does not exist");
      expect(dbDropped).toBe(true);
    });

    it("19. Row count invariant failure is reported and cleaned up", async () => {
      const sql = "CREATE TABLE \"PushNotificationLog_y2026m01\" (id text);";
      const filePath = createArchive("PushNotificationLog_y2026m01.sql.gz", sql);

      let dbDropped = false;

      const mockClient = (_config: any) => {
        return {
          connect: jest.fn(async () => {}),
          query: jest.fn(async (q: string) => {
            if (q.startsWith("CREATE DATABASE")) return { rows: [] };
            if (q.includes("DROP DATABASE")) {
              dbDropped = true;
              return { rows: [] };
            }
            if (q.includes("pg_extension")) {
              return { rows: [{ extname: "vector" }, { extname: "pg_trgm" }, { extname: "postgis" }] };
            }
            if (q.includes("pg_tables")) {
              return { rows: [{ tablename: "PushNotificationLog_y2026m01" }] };
            }
            if (q.includes("count(*)")) {
              return { rows: [{ count: "0" }] };
            }
            return { rows: [] };
          }),
          end: jest.fn(async () => {}),
        } as any;
      };

      const result = await executeRestoreDrill(filePath, {
        restoreDatabaseUrl: "postgresql://user:pw@localhost:5432/ws_test_db",
        pgClientFactory: mockClient,
        tableValidations: {
          PushNotificationLog: {
            tableName: "PushNotificationLog_y2026m01",
            minRowCount: 5,
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("expected at least 5 rows, found 0");
      expect(dbDropped).toBe(true);
    });

    it("20. Missing required PostgreSQL extension fails and cleans up", async () => {
      const sql = "CREATE TABLE test (id text);";
      const filePath = createArchive("PushNotificationLog_y2026m01.sql.gz", sql);

      let dbDropped = false;

      const mockClient = (_config: any) => {
        return {
          connect: jest.fn(async () => {}),
          query: jest.fn(async (q: string) => {
            if (q.startsWith("CREATE DATABASE")) return { rows: [] };
            if (q.includes("DROP DATABASE")) {
              dbDropped = true;
              return { rows: [] };
            }
            if (q.includes("CREATE EXTENSION")) {
              if (q.includes("postgis")) {
                throw new Error("could not open extension control file postgis.control");
              }
              return { rows: [] };
            }
            return { rows: [] };
          }),
          end: jest.fn(async () => {}),
        } as any;
      };

      const result = await executeRestoreDrill(filePath, {
        restoreDatabaseUrl: "postgresql://user:pw@localhost:5432/ws_test_db",
        pgClientFactory: mockClient,
        requiredExtensions: ["vector", "postgis"],
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Failed to enable required extension 'postgis'");
      expect(dbDropped).toBe(true);
    });

    it("21. Oversized archive handling / bounded memory protects against memory exhaustion", () => {
      const largeData = Buffer.alloc(1024 * 1024, "a");
      const compressed = zlib.gzipSync(largeData);

      // Limiting max output length to 10KB
      expect(() => decompressArchiveBounded(compressed, 10 * 1024)).toThrow();
    });

    it("22. Restore timeout handling triggers and cleans up resources", async () => {
      const sql = "CREATE TABLE test (id text);";
      const filePath = createArchive("PushNotificationLog_y2026m01.sql.gz", sql);

      let dbDropped = false;

      const mockClient = (_config: any) => {
        return {
          connect: jest.fn(async () => {}),
          query: jest.fn(async (q: string) => {
            if (q.startsWith("CREATE DATABASE")) return { rows: [] };
            if (q.includes("DROP DATABASE")) {
              dbDropped = true;
              return { rows: [] };
            }
            if (q.includes("pg_extension")) {
              return { rows: [{ extname: "vector" }, { extname: "pg_trgm" }, { extname: "postgis" }] };
            }
            if (q.includes("CREATE TABLE")) {
              // Simulate a hung query that exceeds timeout
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
            return { rows: [] };
          }),
          end: jest.fn(async () => {}),
        } as any;
      };

      const result = await executeRestoreDrill(filePath, {
        restoreDatabaseUrl: "postgresql://user:pw@localhost:5432/ws_test_db",
        pgClientFactory: mockClient,
        restoreTimeoutMs: 50, // 50ms timeout
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("timed out after 50ms");
      expect(dbDropped).toBe(true);
    });

    it("23. SQL statement splitter correctly handles semicolons inside string literals and dollar quotes", () => {
      const complexSql = `
        -- initial comment with semicolon;
        CREATE TABLE "Audit" ("id" text, "msg" text);
        /* multiline comment
           with ; semicolon */
        INSERT INTO "Audit" VALUES ('1', 'msg with ; semicolon inside string');
        DO $$
        BEGIN
          -- block with semicolons
          NULL;
        END;
        $$;
        SELECT 1;
      `;
      const statements = splitSqlStatements(complexSql);
      expect(statements.length).toBe(4);
      expect(statements[1]).toContain("'msg with ; semicolon inside string'");
      expect(statements[2]).toContain("DO $$");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REAL POSTGRESQL INTEGRATION TEST (OPT-IN VIA PARTITION_TEST_DATABASE_URL)
  // ───────────────────────────────────────────────────────────────────────────

  const LIVE_PG_URL = process.env.PARTITION_TEST_DATABASE_URL;
  const describeLivePg = LIVE_PG_URL ? describe : describe.skip;

  describeLivePg("Real PostgreSQL Live Restore Integration", () => {
    it("Executes live restore drill against isolated disposable database and cleans up", async () => {
      const sql = `
        CREATE TABLE "PushNotificationLog_y2026m01" (
          "id" text PRIMARY KEY,
          "userId" text NOT NULL,
          "title" text NOT NULL,
          "body" text NOT NULL,
          "status" text NOT NULL,
          "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO "PushNotificationLog_y2026m01" ("id", "userId", "title", "body", "status")
        VALUES ('notif_1', 'user_1', 'Welcome', 'Hello world', 'DELIVERED');
      `;
      const _filePath = createArchive("PushNotificationLog_y2026m01.sql.gz", sql, {
        addChecksumFile: true,
      });

      const summary = await scanAndVerifyBackupsAsync(tempDir, {
        requireCoverage: true,
        restoreDatabaseUrl: LIVE_PG_URL,
        tableValidations: {
          PushNotificationLog: {
            tableName: "PushNotificationLog_y2026m01",
            minRowCount: 1,
          },
        },
      });

      expect(summary.totalArchives).toBe(1);
      expect(summary.validArchives).toBe(1);
      expect(summary.restoreDrillPassed).toBe(true);
      expect(summary.reports[0].restoredSuccessfully).toBe(true);
      expect(summary.reports[0].validatedTables).toContain("PushNotificationLog_y2026m01");
    });
  });
});
