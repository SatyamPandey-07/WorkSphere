# Troubleshooting Prisma Database Migration Failures & Schema Drift

## Executive Summary

When developing on WorkSphere across multiple feature branches, contributors frequently encounter schema drift, failed database migrations, connection locks, or out-of-sync database errors. This document serves as the authoritative guide for diagnosing, resolving, and preventing Prisma database issues in both local development environments and CI/CD production pipelines.

---

## 1. Architectural Overview of Prisma Migration Pipeline

Prisma uses a declarative migration engine that compares your Prisma schema file ([prisma/schema.prisma](file:///c:/Users/admin/Desktop/workfere/prisma/schema.prisma)) against the current database structure and the migration history recorded in the `_prisma_migrations` table.

```mermaid
flowchart TD
    A["prisma/schema.prisma"] --> B["Prisma Migration Engine"]
    C["Database State (PostgreSQL)"] --> B
    D["prisma/migrations/ Directory"] --> B
    E["_prisma_migrations Table"] --> B
    
    B --> F{"Schema & DB Match?"}
    F -- "Yes" --> G["Schema is In Sync"]
    F -- "No: Unapplied Migration Files" --> H["Pending Migrations: Run 'prisma migrate dev'"]
    F -- "No: DB Drifted Without Migration File" --> I["Schema Drift Detected (P3005)"]
    F -- "No: Migration Recorded as Failed in DB" --> J["Failed Migration Detected (P3009)"]
```

### 1.1 The `_prisma_migrations` System Table

Prisma tracks the execution state of every applied migration file in a dedicated system table named `_prisma_migrations`.

```sql
CREATE TABLE _prisma_migrations (
    id                  VARCHAR(36) PRIMARY KEY NOT NULL,
    checksum            VARCHAR(64) NOT NULL,
    finished_at         TIMESTAMPTZ,
    migration_name      VARCHAR(255) NOT NULL,
    logs                TEXT,
    rolled_back_at      TIMESTAMPTZ,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
);
```

#### Key Fields & Meanings

- **`finished_at`**: NULL indicates that the migration started but failed mid-execution.
- **`checksum`**: SHA-256 hash of the `migration.sql` file. If a migration file is edited post-application, Prisma flags a checksum mismatch error (`P3008`).
- **`rolled_back_at`**: Non-NULL timestamp indicating that the migration was marked as rolled back using `prisma migrate resolve --rolled-back`.

---

## 2. Common Error Signatures Quick Reference

| Error Code | Summary Message | Typical Root Cause | Quick Resolution Command |
| :--- | :--- | :--- | :--- |
| **`P3005`** | *The database schema is out of sync with the migration history.* | Manual DB changes or switching branches with uncommitted schema changes. | `npx prisma db push` OR `npx prisma migrate reset` |
| **`P3006`** | *Migration failed to apply cleanly to the shadow database.* | Invalid SQL syntax or unsupported column type changes in `migration.sql`. | Fix `migration.sql` or use `npx prisma migrate dev --create-only` |
| **`P3008`** | *The migration has already been applied, but its code has changed.* | A previously committed `migration.sql` file was edited locally. | Revert edits to `migration.sql` or reset local DB |
| **`P3009`** | *found failed migrations in the target database.* | A migration threw an SQL exception halfway through execution. | `npx prisma migrate resolve --rolled-back <migration_name>` |
| **`P3014`** | *Prisma Migrate could not create the shadow database.* | User lacks `CREATEDB` privileges in PostgreSQL connection URL. | Grant privileges or specify explicit `SHADOW_DATABASE_URL` |
| **`P3018`** | *A migration failed to apply. Submitted migration code resulted in an error.* | Foreign key constraint violation or non-null column added without default value. | Add default value or resolve data constraint before migration |

---

## 3. Resolving "Database schema is out of sync" (`P3005`)

### 3.1 Understanding Schema Drift

Schema drift occurs when your local database structure diverges from the migration history stored in `prisma/migrations/`. Common scenarios include:

1. **Branch Switching**: Switching from `feature/user-profiles` (which ran a migration) to `main` (which does not contain that migration file).
2. **Manual DB Edits**: Modifying tables directly via DBeaver, pgAdmin, or raw SQL queries without updating `schema.prisma`.
3. **Using `prisma db push` on Feature Branches**: Applying direct schema changes without generating declarative migration files.

### 3.2 Step-by-Step Resolution Procedures

```
                       +-----------------------------------+
                       | Error P3005: Schema Out of Sync   |
                       +-----------------------------------+
                                         |
                                         v
                       +-----------------------------------+
                       |   Do you need to preserve local   |
                       |    development seed data?         |
                       +-----------------------------------+
                                     /       \
                               Yes  /         \  No
                                   /           \
                                  v             v
        +----------------------------------+  +----------------------------------+
        |   Use Preserving Recovery Path   |  |   Use Clean Slate Recovery Path  |
        |   (prisma db push + generate)    |  |   (prisma migrate reset)         |
        +----------------------------------+  +----------------------------------+
```

#### Path A: Data-Preserving Recovery Path (Recommended for active dev testing)

Use this approach when your local database contains valuable mock data or manual test records that you do not want to destroy.

1. **Synchronize local schema without generating new migrations**:
   ```bash
   npx prisma db push --accept-data-loss
   ```
2. **Re-generate Prisma Client types**:
   ```bash
   npx prisma generate
   ```
3. **Verify current status**:
   ```bash
   npx prisma migrate status
   ```

#### Path B: Clean Slate Recovery Path (Recommended for branch switches)

Use this approach when switching back to `main` or starting fresh work.

> [!CAUTION]
> **DATA LOSS WARNING**: Running `npx prisma migrate reset` will drop the target database, recreate it, apply all migrations from scratch, and execute `prisma/seed.ts`. All existing records will be permanently deleted.

1. **Execute full database reset**:
   ```bash
   npx prisma migrate reset --force
   ```
2. **Generate client and re-seed data**:
   ```bash
   npx prisma generate
   npx prisma db seed
   ```

---

## 4. Deep Dive: `prisma db push` vs `prisma migrate dev` vs `prisma migrate reset`

Choosing the correct Prisma command is critical to preventing broken migration histories in Git repository commits.

### 4.1 Detailed Command Comparison Matrix

| Command | Modifies Database Structure? | Creates `migration.sql` File? | Destroys Existing Data? | Primary Use Case |
| :--- | :---: | :---: | :---: | :--- |
| `npx prisma db push` | **Yes** | **No** | Only if breaking changes confirmed | Prototyping local schema changes rapidly without polluting migration history. |
| `npx prisma migrate dev` | **Yes** | **Yes** | No (unless reset required) | Finalizing a feature schema change to commit to Git repository. |
| `npx prisma migrate reset` | **Yes (Drops DB)** | **No** | **YES (Complete Drop)** | Resetting dirty local development state to match `main` branch. |
| `npx prisma migrate deploy` | **Yes** | **No** | No | Applying unapplied migrations in CI/CD, Staging, and Production. |
| `npx prisma migrate status` | **No** | **No** | No | Diagnostics check to inspect pending or failed migrations. |

---

### 4.2 When to Use `npx prisma db push`

Use `npx prisma db push` when:
- You are rapidly experimenting with new models, relations, or fields in `schema.prisma`.
- You do not yet want to commit permanent SQL migration files to `prisma/migrations/`.
- You are working in an isolated ephemeral database (e.g., Docker container).

> [!NOTE]
> **Best Practice**: Never use `npx prisma db push` on staging or production databases. Always generate migration files using `npx prisma migrate dev` before opening a Pull Request.

---

### 4.3 When to Use `npx prisma migrate dev`

Use `npx prisma migrate dev` when:
- You have finalized changes in `schema.prisma` and are ready to create a migration artifact.
- You need to write custom SQL transformations (e.g., data backfills, custom indexes, enums).

```bash
# Create a named migration file
npx prisma migrate dev --name add_user_notification_preferences
```

This command automatically:
1. Creates a new timestamped folder in `prisma/migrations/YYYYMMDDHHMMSS_add_user_notification_preferences/`.
2. Generates the `migration.sql` script.
3. Applies the SQL script to your local development database.
4. Updates the `_prisma_migrations` system table.
5. Runs `npx prisma generate` to refresh `@prisma/client` TypeScript bindings.

---

### 4.4 When to Use `npx prisma migrate reset`

Use `npx prisma migrate reset` when:
- Your local database has reached an unrecoverable corrupted state or failed migration loop.
- You switched branches from a feature branch with incompatible schema changes back to `main`.
- You want to test fresh database creation and seed execution from zero.

```bash
npx prisma migrate reset
```

---

## 5. Repairing Failed Production Migrations (`_prisma_migrations` Table Repair)

If a migration fails in staging or production (e.g., due to an execution timeout, lock contention, or bad SQL statement), Prisma prevents subsequent migrations from executing until the failed entry in `_prisma_migrations` is marked as resolved or rolled back.

```
Error: Found failed migrations in the target database:
20261005120000_add_venue_noise_level_column
```

### 5.1 Step 1: Diagnose the Failed Migration

Inspect the `_prisma_migrations` table directly via SQL query to review error logs:

```sql
SELECT id, migration_name, started_at, finished_at, rolled_back_at, logs 
FROM _prisma_migrations 
WHERE finished_at IS NULL AND rolled_back_at IS NULL;
```

---

### 5.2 Step 2: Mark Failed Migration as Rolled Back

If the migration partially failed and you have manually restored or rolled back the database schema changes:

```bash
npx prisma migrate resolve --rolled-back "20261005120000_add_venue_noise_level_column"
```

This updates `rolled_back_at = NOW()` in `_prisma_migrations`, allowing Prisma to attempt re-applying the corrected migration.

---

### 5.3 Step 3: Mark Failed Migration as Applied / Resolved

If you manually executed the SQL changes in PostgreSQL directly to fix the failure and want Prisma to record it as complete:

```bash
npx prisma migrate resolve --applied "20261005120000_add_venue_noise_level_column"
```

This sets `finished_at = NOW()` and `applied_steps_count = 1` in `_prisma_migrations`.

---

## 6. Managing Git Branch Workflow & Migration Merges

### 6.1 Collision Avoidance When Multiple Contributors Create Migrations

When two developers create Prisma migrations concurrently on separate feature branches:

- Developer A creates: `prisma/migrations/20261006100000_add_table_a/`
- Developer B creates: `prisma/migrations/20261006100500_add_table_b/`

When both branches are merged into `main`, Prisma executes them sequentially by timestamp. However, if Developer B's migration depends on Developer A's changes without reflecting them, conflicts occur.

#### Git Conflict Resolution Steps

1. **Checkout target branch (`main`) and pull latest changes**:
   ```bash
   git checkout main
   git pull origin main
   ```
2. **Checkout your feature branch and rebase**:
   ```bash
   git checkout feature/my-changes
   git rebase main
   ```
3. **If migration folder conflicts occur**:
   - Delete your local feature branch migration folder: `rm -rf prisma/migrations/20261006100500_my_feature/`
   - Re-run `npx prisma migrate dev --name my_feature` to generate a new migration file positioned AFTER main's latest migration.

---

## 7. Shadow Database Configuration & Permission Errors

Prisma Migrate uses a temporary **Shadow Database** during `prisma migrate dev` to detect schema drift and verify that new migration files apply cleanly from scratch.

```mermaid
flowchart LR
    A["prisma/schema.prisma"] --> B["Prisma Engine"]
    B --> C["Local Dev DB (worksphere_dev)"]
    B --> D["Shadow DB (worksphere_shadow)"]
    D -- "Verify clean replay of all migrations" --> E{"Clean Replay?"}
    E -- "Yes" --> F["Generate migration.sql"]
    E -- "No (P3006)" --> G["Abort Migration Generation"]
```

### 7.1 Troubleshooting Shadow Database Errors (`P3014`)

If your database user does not have permission to create databases (`CREATEDB` privilege in PostgreSQL), Prisma throws error `P3014`.

#### Solution 1: Grant `CREATEDB` Privilege to PostgreSQL User

```sql
-- Run as superuser (e.g. postgres) in psql
ALTER USER worksphere_user WITH CREATEDB;
```

#### Solution 2: Explicitly Define `SHADOW_DATABASE_URL`

If using a cloud database provider (e.g., Supabase, Neon, AWS RDS) where `CREATEDB` is restricted, create a second empty database manually and define `SHADOW_DATABASE_URL` in [.env](file:///c:/Users/admin/Desktop/workfere/.env):

```env
# .env configuration
DATABASE_URL="postgresql://user:password@localhost:5432/worksphere_dev?schema=public"
SHADOW_DATABASE_URL="postgresql://user:password@localhost:5432/worksphere_shadow?schema=public"
```

---

## 8. Database Seeding & Recovery Workflows

After executing `prisma migrate reset`, your database tables will be empty. WorkSphere includes an automated seed script configured in `package.json`:

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

### 8.1 Manually Triggering Seed Data Re-population

```bash
# Generate client bindings
npx prisma generate

# Execute seed script
npx prisma db seed
```

### 8.2 Seed Script Safety Measures

Ensure [prisma/seed.ts](file:///c:/Users/admin/Desktop/workfere/prisma/seed.ts) uses idempotent upsert operations (`prisma.user.upsert()`) rather than direct `create()` statements to prevent duplicate key constraint failures when re-running seeds.

```typescript
// Example idempotent seed pattern
await prisma.venue.upsert({
  where: { slug: "quiet-zone-library" },
  update: {},
  create: {
    name: "Quiet Zone Library",
    slug: "quiet-zone-library",
    noiseLevel: "QUIET",
    capacity: 50,
  },
});
```

---

## 9. Complex Migration Scenarios & Custom SQL Customizations

When simple field additions are insufficient, customized migrations require editing the auto-generated `migration.sql` file prior to execution.

### 9.1 Custom Migration Workflow (`--create-only`)

To create an unapplied migration file for manual SQL customization:

```bash
npx prisma migrate dev --create-only --name rename_user_column_with_backfill
```

Edit the generated file in `prisma/migrations/<timestamp>_rename_user_column_with_backfill/migration.sql`:

```sql
-- Step 1: Add new column
ALTER TABLE "User" ADD COLUMN "fullName" TEXT;

-- Step 2: Backfill existing data
UPDATE "User" SET "fullName" = CONCAT("firstName", ' ', "lastName");

-- Step 3: Make new column mandatory
ALTER TABLE "User" ALTER COLUMN "fullName" SET NOT NULL;

-- Step 4: Drop old columns
ALTER TABLE "User" DROP COLUMN "firstName";
ALTER TABLE "User" DROP COLUMN "lastName";
```

Apply the customized migration:

```bash
npx prisma migrate dev
```

---

## 10. PgBouncer Connection Pooling & Transaction Mode Pitfalls

When connecting Prisma Migrate to PostgreSQL instances utilizing PgBouncer or serverless connection proxies (e.g., Supabase, Neon), standard transaction mode pooling can cause migration hangs or advisory lock errors (`P3014`).

### 10.1 Direct Connection Configuration for Migrations

Prisma Migrate requires direct connection access to PostgreSQL advisory locks and prepared statements. PgBouncer in **Transaction Mode** does not support advisory locks.

#### Dual URL Configuration in `.env`

```env
# Connection URL for application runtime (PgBouncer pooler port 6543)
DATABASE_URL="postgresql://user:pass@ep-cool-pooler.us-east-1.aws.neon.tech:6543/worksphere?pgbouncer=true&schema=public"

# Direct connection URL for migrations (Direct port 5432)
DIRECT_URL="postgresql://user:pass@ep-cool-direct.us-east-1.aws.neon.tech:5432/worksphere?schema=public"
```

#### Update `schema.prisma` Datasource Definition

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

With `directUrl` configured, runtime queries utilize PgBouncer via `DATABASE_URL`, while `prisma migrate dev` and `prisma migrate deploy` automatically route through `DIRECT_URL`.

---

## 11. CI/CD Automated Migration Pipeline Integration

To guarantee schema consistency in GitHub Actions CI/CD deployment workflows, use `prisma migrate deploy` combined with `prisma migrate status`.

### 11.1 Recommended GitHub Actions Workflow Step (`.github/workflows/deploy.yml`)

```yaml
name: Database Migration Check & Deployment

on:
  push:
    branches: [main]

jobs:
  migrate:
    name: Run Production Database Migrations
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Setup Node.js Environment
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Project Dependencies
        run: npm ci

      - name: Check Pending Migration Status
        run: npx prisma migrate status
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DIRECT_DATABASE_URL }}

      - name: Execute Pending Migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DIRECT_DATABASE_URL }}

      - name: Generate Prisma Client Artifacts
        run: npx prisma generate
```

---

## 12. Automated Health Check & Reset Helper Scripts

To simplify local development maintenance, contributors can utilize shell helper scripts.

### 12.1 Bash Health Check Script (`scripts/check-prisma-health.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==============================================="
echo "   WorkSphere Prisma Migration Health Check    "
echo "==============================================="

# Check environment variable presence
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[ERROR] DATABASE_URL environment variable is not defined."
  exit 1
fi

echo "[1/3] Verifying Prisma Schema Syntax..."
npx prisma validate

echo "[2/3] Checking Migration Status against Database..."
if ! npx prisma migrate status; then
  echo "[WARNING] Migration drift or pending migrations detected!"
  echo "Run 'npx prisma migrate dev' to generate missing migrations,"
  echo "or run 'npx prisma migrate reset' to start fresh."
  exit 1
fi

echo "[3/3] Verifying Client Code Generation..."
npx prisma generate

echo "[SUCCESS] All Prisma schema and migration checks passed cleanly!"
```

---

## 13. Zero-Downtime Production Migration Guidelines

When deploying schema changes to production, follow the **Expand & Contract Pattern** to ensure backwards compatibility with running backend instances.

```
Phase 1: Expand (Add nullable columns / new tables)
Phase 2: Deploy Code (Update application to write to both old and new columns)
Phase 3: Backfill Data (Migrate existing data to new structure)
Phase 4: Contract (Drop deprecated columns / old tables in subsequent migration)
```

### 13.1 Rules for Production Migrations

1. **Never drop columns or tables in a single step**: Make columns optional (`NULL`) first.
2. **Never add non-null columns without default values**: Always specify `@default(...)`.
3. **Always test `npx prisma migrate deploy` locally** against a database backup before triggering production deployment pipelines.

---

## 14. Automated Diagnostics Checklist

Run through this quick checklist whenever encountering Prisma database issues:

- [ ] Is `DATABASE_URL` set correctly in `.env`?
- [ ] Is PostgreSQL container running (`docker ps`)?
- [ ] Have you run `npx prisma generate` after changing `schema.prisma`?
- [ ] Does `npx prisma migrate status` report unapplied migrations?
- [ ] Is `_prisma_migrations` free of failed entries (`finished_at IS NOT NULL`)?
- [ ] Did you check shadow database permissions if `prisma migrate dev` fails?
- [ ] Is `DIRECT_URL` configured if utilizing PgBouncer connection pooling?
