# Prisma Database Migrations Guide

## Overview

WorkSphere uses **Prisma** as its ORM to manage schema synchronization and migrations across development, staging, and production environments.

This guide covers the full migration lifecycle: creating and applying migrations in development, deploying to production/staging, and handling rollbacks and squashing.

---

## 0. Day-to-Day Migration Workflow

### Creating a migration

After editing `prisma/schema.prisma`, generate a migration file:

```bash
npx prisma migrate dev --name describe-what-changed
```

This command:
1. Generates SQL in `prisma/migrations/<timestamp>_describe-what-changed/migration.sql`
2. Applies the migration to your local database
3. Regenerates the Prisma client

Review the generated SQL before committing — never commit a migration you haven't read.

### Regenerating the client without migrating

```bash
npx prisma generate
```

Run this after pulling changes that include new migrations to keep the TypeScript types in sync.

### Applying pending migrations in CI / staging / production

```bash
npx prisma migrate deploy
```

`migrate deploy` applies any pending migrations without prompting and without creating new ones. Use this in your deployment pipeline (never `migrate dev` in production).

### Checking migration status

```bash
npx prisma migrate status
```

Shows which migrations have been applied and whether any are pending.

---

## 4. Squashing Old Migrations

As the migration history grows, you can squash a sequence of migrations into a single baseline migration. This is useful for new team members who want to avoid replaying many tiny early-development migrations.

> **Warning:** Only squash migrations that have already been applied to all environments (development, staging, production). Never squash a migration that is pending in any environment.

### Steps

1. **Create a baseline from the current schema:**

   ```bash
   # Export the current database state to a single SQL file
   npx prisma migrate diff \
     --from-empty \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/0_init/migration.sql
   ```

2. **Mark the baseline as applied** (tells Prisma the DB is already in this state):

   ```bash
   npx prisma migrate resolve --applied 0_init
   ```

3. **Delete the old individual migration directories** that are now covered by the baseline.

4. Commit the single `0_init` migration directory.

After squashing, new environments will apply only the baseline migration, not every historical migration.

---

## 1. Schema Drift Resolution

### What is Schema Drift?
Schema drift occurs when your local database structure changes outside of Prisma's migration history (e.g., manual schema tweaks in your DB client) or when another developer merges migration changes that are out of sync with your local DB.

### Diagnosis
If you see errors like `The database schema is not empty...` or `Migration ... is not in the migrations table...` when running `npx prisma migrate dev`, your schema has drifted.

### Troubleshooting Steps

#### Option A: Force Local Sync (For Prototyping)
If you are rapidly prototyping locally and want to sync your database structure without creating formal migration files, bypass migrations temporarily:
```bash
npx prisma db push
```
*Note: This command will attempt to update the database to match your `schema.prisma` directly, but may warn if it needs to perform data-destructive changes.*

#### Option B: Resolve Drift via Prisma Migrate Resolve
If a specific migration failed halfway through or became desynchronized, you can use the `migrate resolve` CLI command to mark migrations as manually resolved:

*   **Mark a migration as applied:** (Tells Prisma to assume the migration has already run)
    ```bash
    npx prisma migrate resolve --applied <migration_name>
    ```
*   **Mark a migration as rolled back:** (Tells Prisma to assume the migration was undone)
    ```bash
    npx prisma migrate resolve --rolled-back <migration_name>
    ```

---

## 2. Database Migration Rollbacks

Prisma does not generate automatic "down" migrations. To roll back changes safely, use one of the two strategies below:

### Strategy A: Rollback via Revert Migration (Safe & Recommended)

This is the standard approach for production and team collaboration as it maintains chronological migration history.

1.  Open your `prisma/schema.prisma` file.
2.  Revert the manual changes (fields, models, or relations) back to their original state.
3.  Generate a new migration to apply this revert change:
    ```bash
    npx prisma migrate dev --name revert_previous_change
    ```
4.  Apply this migration to the database to sync the reverted state:
    ```bash
    npx prisma migrate deploy
    ```

### Strategy B: Recovering From a Failed Migration

If a migration fails on deployment, the database might be left in a partial state:

1.  Identify the failed migration name (found in your error log or via `npx prisma migrate status`).
2.  Roll back the state manually inside your database console if half-applied tables exist.
3.  Tell Prisma to forget about the failed migration by marking it as rolled back:
    ```bash
    npx prisma migrate resolve --rolled-back <failed_migration_name>
    ```
4.  Correct the migration file or `schema.prisma` definitions, and re-run:
    ```bash
    npx prisma migrate dev
    ```

---

## 3. Local Database Resets & Mock Seeding

During development, you may want to purge all records and re-initialize the database with clean mock assets.

### Automated Reset & Seed
To completely drop all tables, recreate the schema from scratch, and execute the mock data seeder:
```bash
npx prisma migrate reset
```
*Warning: This drops all data in your target database and cannot be undone. Do not run this against production databases.*

### Manual Seeding
If you already have a synced schema and only want to populate mock venues and credentials:
```bash
npx prisma db seed
```

### Seeding Capabilities in WorkSphere
The seed script (`prisma/seed.js`) automatically populates:
-   **Mock Venues**: Cafes, libraries, and coworking spaces with randomized WiFi quality, outlets, and noise levels.
-   **Gamification Badges**: Standard badges (e.g. WiFi Scout, Cafe Nomad, Night Owl) that users can earn on the platform.
-   **Initial Admin Credentials & Configurations** as necessary.
