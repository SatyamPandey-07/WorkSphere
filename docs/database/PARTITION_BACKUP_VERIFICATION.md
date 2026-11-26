# Partition Backup Verification and Restore Drills

This guide explains how to verify existing partition backup archives, check expected partition coverage and backup freshness, and optionally perform an isolated restore drill using a disposable PostgreSQL database.

The verification utility is:

```text
scripts/verify-partition-backups.ts
```

Run it through the package script:

```bash
npm run db:verify-partitions
```

## 1. What the verifier checks

The utility scans a directory for compressed SQL backup archives and performs the following checks:

- **Archive discovery:** Finds `.sql.gz` and `.gz` files.
- **File integrity:** Detects unreadable, missing, or zero-byte archives.
- **GZIP format:** Checks the expected GZIP magic bytes.
- **Checksum verification:** Compares archive contents against a supported SHA-256 checksum when one is available.
- **Decompression:** Attempts to decompress the archive, with a default maximum uncompressed size of 100 MiB.
- **SQL structure:** Performs a basic heuristic check for recognizable SQL statements or PostgreSQL-related content.
- **Freshness:** Optionally identifies archives older than a configured maximum age.
- **Coverage:** Optionally checks whether expected partition archive names are present.
- **Restore drill:** Optionally restores valid archives into a temporary, disposable PostgreSQL database.

**Important limitations**

A successful verification does not prove that every SQL statement is semantically correct or that the archive can restore a complete production environment. SQL structure validation is heuristic, not a full SQL parser or database validation.

The utility verifies existing archives. It does not create backups, upload them to object storage, or perform production restores.

## 2. Backup directory

By default, the verifier scans:

```text
backups/partitions
```

The target directory can be overridden using either:

1. The first positional command-line argument.
2. The `PARTITION_BACKUP_DIR` environment variable.
3. The default `backups/partitions` directory.

The positional argument takes precedence over the environment variable.

Example:

```bash
npm run db:verify-partitions -- ./backups/partitions
```

To configure the directory through an environment variable:

**PowerShell**

```powershell
$env:PARTITION_BACKUP_DIR = ".\backups\partitions"
npm run db:verify-partitions
```

**Bash**

```bash
export PARTITION_BACKUP_DIR="./backups/partitions"
npm run db:verify-partitions
```

The verifier scans files matching `.sql.gz` or `.gz`, case-insensitively. Checksum sidecar files are not treated as backup archives.

## 3. Configuration

The utility supports the following environment variables.

| Variable                            | Purpose                                                 | Behavior                                                                                            |
| ----------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PARTITION_BACKUP_DIR`              | Backup directory to scan                                | Defaults to `backups/partitions`; overridden by a positional directory argument.                    |
| `PARTITION_BACKUP_REQUIRE_COVERAGE` | Controls required archive coverage                      | Defaults to enabled when unset. Set to `true` or `1` to enable; another explicit value disables it. |
| `PARTITION_BACKUP_EXPECTED`         | Comma-separated expected partition archive names        | Used for coverage checks when coverage is required.                                                 |
| `PARTITION_BACKUP_MAX_AGE_HOURS`    | Maximum permitted archive age in hours                  | A valid positive value enables stale-archive detection.                                             |
| `PARTITION_TEST_DATABASE_URL`       | Local PostgreSQL endpoint for an optional restore drill | When configured, enables isolated restore checks for valid archives.                                |

### Example: Configure coverage and freshness

**PowerShell**

```powershell
$env:PARTITION_BACKUP_REQUIRE_COVERAGE = "true"
$env:PARTITION_BACKUP_EXPECTED = "partition_2026_01.sql.gz,partition_2026_02.sql.gz"
$env:PARTITION_BACKUP_MAX_AGE_HOURS = "168"

npm run db:verify-partitions
```

**Bash**

```bash
export PARTITION_BACKUP_REQUIRE_COVERAGE="true"
export PARTITION_BACKUP_EXPECTED="partition_2026_01.sql.gz,partition_2026_02.sql.gz"
export PARTITION_BACKUP_MAX_AGE_HOURS="168"

npm run db:verify-partitions
```

Replace the example archive names with the names expected in the actual backup directory.

Expected names are trimmed and empty entries are ignored. The verifier matches an expected value against the archive filename or its extracted base name.

### Coverage behavior

Coverage is enabled by default unless explicitly disabled.

When coverage is required, the verifier reports a failure if the backup directory is missing, contains no matching archives, or does not contain the expected partition archives.

To disable the requirement explicitly:

**PowerShell**

```powershell
$env:PARTITION_BACKUP_REQUIRE_COVERAGE = "false"
npm run db:verify-partitions
```

**Bash**

```bash
export PARTITION_BACKUP_REQUIRE_COVERAGE="false"
npm run db:verify-partitions
```

### Freshness behavior

When `PARTITION_BACKUP_MAX_AGE_HOURS` is configured with a valid positive number, the verifier checks archive age against that threshold.

It attempts to derive timestamps from recognized filename patterns:

- `_yYYYYmMM`
- `YYYY_MM` or `YYYY-MM`
- `YYYYMMDD_HHMMSS` or `YYYYMMDD`

If a recognized timestamp is unavailable, the file modification time is used.

Archives exceeding the configured age are reported as `STALE`.

## 4. Checksum verification

The verifier calculates a SHA-256 digest for each readable archive.

It looks for an expected checksum in either:

- A sidecar file named `<archive>.sha256`.
- A directory-level manifest named `checksums.txt`, `SHA256SUMS`, or `checksums.sha256`.

Manifest entries are matched against the archive filename.

When a checksum is available, the verifier compares it with the calculated digest. A mismatch is reported as `CHECKSUM_MISMATCH`.

**Checksum files are optional in the current implementation.** If no matching checksum is found, the verifier records that no checksum comparison was available; the absence of a checksum does not independently fail the archive.

For this reason, a `VALID` result should not be interpreted as proof that an external checksum was verified in every case.

## 5. Verification results

The verifier reports individual archive statuses and a summary.

Statuses assigned by the current implementation include:

| Status                  | Meaning                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `VALID`                 | The archive passed the implemented verification checks.              |
| `CORRUPTED`             | The archive could not be read or does not exist.                     |
| `ZERO_BYTE`             | The archive is empty.                                                |
| `INVALID_MAGIC_BYTES`   | The file does not have the expected GZIP signature.                  |
| `CHECKSUM_MISMATCH`     | An available expected checksum does not match the calculated digest. |
| `DECOMPRESSION_FAILED`  | The archive could not be decompressed.                               |
| `INVALID_SQL_STRUCTURE` | Decompressed content did not pass the basic SQL structure check.     |
| `STALE`                 | The archive exceeds the configured maximum age.                      |
| `RESTORE_FAILED`        | The optional restore drill failed for the archive.                   |

The summary includes information such as:

- Total archives scanned.
- Valid, corrupted, zero-byte, and stale archive counts.
- Restore failures.
- Missing expected archive names.
- Coverage and restore-drill results.
- Per-archive reports and errors.

The SQL structure check looks for recognizable content such as `CREATE TABLE`, `COPY`, `INSERT INTO`, `ALTER TABLE`, `SET SCHEMA`, or `POSTGRESQL`. It is a lightweight heuristic and does not replace actual database restoration.

## 6. Optional isolated restore drill

The restore drill is optional. It runs only when `PARTITION_TEST_DATABASE_URL` is configured and an archive has already passed the preceding verification checks.

The configured URL must point to a **local, disposable PostgreSQL environment**.

### Safety requirements

The utility validates the configured database URL before attempting a restore.

The safety checks require:

- A valid PostgreSQL connection URL.
- A local host such as `localhost`, `127.0.0.1`, `::1`, `postgres`, or `test-postgres`.
- A database name indicating a test or disposable environment, such as one containing `test`, `drill`, `temp`, or `disposable`, or starting with `worksphere_dev`.
- A database name and host that do not match the explicitly blocked production, staging, or managed-cloud patterns.

**Never configure `PARTITION_TEST_DATABASE_URL` with production, staging, or any database containing data that must be preserved.**

### How the restore drill works

The configured URL is used as a safe local PostgreSQL endpoint. It is not used as the target database for importing the archive.

Instead, the utility:

1. Validates the configured endpoint.
2. Connects to its PostgreSQL administrative database.
3. Creates a uniquely named temporary database.
4. Attempts to ensure the required extensions are available:
   - `vector`
   - `pg_trgm`
   - `postgis`
5. Restores the verified archive into the temporary database.
6. Checks that at least one user table was restored.
7. Cleans up the temporary database and associated connections.

The default restore timeout is 30 seconds.

The current CLI does not expose custom table-validation rules. The restore check therefore verifies that at least one user table exists after restoration; it does not establish that every expected table, row count, index, or application-level invariant has been restored.

### Configure a disposable test endpoint

Only use a local PostgreSQL instance created specifically for testing.

**PowerShell example**

```powershell
$env:PARTITION_TEST_DATABASE_URL = "postgresql://postgres:password@localhost:5432/worksphere_test"
npm run db:verify-partitions
```

Replace the example credentials with the credentials for your disposable local database.

Do not commit database credentials or place real secrets in documentation, source control, or shared logs.

## 7. Running a verification workflow

A basic verification run:

```bash
npm run db:verify-partitions
```

A run with an explicit backup directory:

```bash
npm run db:verify-partitions -- ./backups/partitions
```

A run with coverage and freshness checks:

```bash
PARTITION_BACKUP_REQUIRE_COVERAGE=true \
PARTITION_BACKUP_EXPECTED="partition_2026_01.sql.gz,partition_2026_02.sql.gz" \
PARTITION_BACKUP_MAX_AGE_HOURS=168 \
npm run db:verify-partitions
```

A run with an optional restore drill should additionally configure `PARTITION_TEST_DATABASE_URL` with a safe disposable local PostgreSQL endpoint.

Review the output for:

- Unexpected missing archives.
- Non-`VALID` archive statuses.
- Checksum mismatches.
- Stale backups.
- Coverage failures.
- Restore failures.

Investigate reported failures before treating the backup set as ready for recovery.

## 8. Exit behavior and operational response

The CLI exits with a non-zero status when it detects conditions such as:

- Zero-byte or corrupted archives.
- Stale archives.
- Restore failures.
- Failed required coverage.
- Failed restore-drill results.
- Verification errors.

A successful exit indicates that the configured checks passed. It does not guarantee production recoverability or replace a complete disaster-recovery exercise.

When verification fails:

1. Identify the affected archive and reported status.
2. Check the source backup job and the archive's transfer or storage history.
3. Confirm whether the expected archive and checksum files are present.
4. Regenerate or retrieve a valid backup through the established backup process when necessary.
5. Re-run verification after correcting the underlying problem.
6. If a restore drill fails, inspect the PostgreSQL environment, required extensions, SQL compatibility, and reported restore error before retrying.

Do not delete or overwrite the only available backup while investigating a failure.

## 9. Related documentation

For broader partition lifecycle and operational procedures, see:

- [Database Partitioning Runbook](../DATABASE_PARTITIONING_RUNBOOK.md)

For the repository's documentation index, see:

- [Documentation Index](../README.md)
