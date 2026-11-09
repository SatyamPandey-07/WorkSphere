# Local Database Setup with PostgreSQL & Prisma

## Overview

WorkSphere relies on **PostgreSQL 15+** (with optional `pgvector` extension support) and **Prisma ORM** for relational data persistence, schema migrations, and database seeding.

This guide walks new contributors step-by-step through setting up a local database instance, configuring environment variables, running migrations, seeding test venues and workspaces, and resolving common connection pitfalls.

---

## 1. Prerequisites

Before setting up your database, ensure your local development machine has the following installed:

- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **Package Manager**: `npm` (`v10+`)
- **PostgreSQL**: `v15.x` or `v16.x`
  - *macOS (Homebrew):* `brew install postgresql@15 && brew services start postgresql@15`
  - *Ubuntu / Debian:* `sudo apt update && sudo apt install postgresql postgresql-contrib`
  - *Windows:* Install via [EnterpriseDB PostgreSQL Installer](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) or Docker.
  - *Docker (Alternative):*
    ```bash
    docker run --name worksphere-postgres \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB=worksphere \
      -p 5432:5432 -d postgres:15-alpine
    ```

---

## 2. PostgreSQL Database Creation

Open your terminal or `psql` interactive terminal to create a dedicated database and user for WorkSphere:

```sql
-- Connect to local PostgreSQL
psql -U postgres

-- Create dedicated user and database
CREATE USER worksphere WITH PASSWORD 'worksphere_dev_password';
CREATE DATABASE worksphere OWNER worksphere;
GRANT ALL PRIVILEGES ON DATABASE worksphere TO worksphere;

-- Grant schema permissions for Prisma migrations (PostgreSQL 15+)
\c worksphere
GRANT ALL ON SCHEMA public TO worksphere;
GRANT CREATE ON SCHEMA public TO worksphere;

\q
```

---

## 3. Environment Configuration (`.env.local`)

In the project root, copy the environment template or create `.env.local`:

```bash
cp .env.example .env.local
```

Configure your `DATABASE_URL` connection string:

```env
# Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
DATABASE_URL="postgresql://worksphere:worksphere_dev_password@localhost:5432/worksphere?schema=public"

# Optional Direct URL for migrations if using connection poolers (e.g., Supabase / PgBouncer)
DIRECT_URL="postgresql://worksphere:worksphere_dev_password@localhost:5432/worksphere?schema=public"

# Authentication & Application Baseline
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

---

## 4. Prisma Migrations & Client Generation

WorkSphere uses Prisma to maintain declarative database schemas (`prisma/schema.prisma`).

### Step 1: Generate Prisma Client
Generates type-safe TypeScript query bindings under `node_modules/@prisma/client`:

```bash
npx prisma generate
```

### Step 2: Apply Migrations
Applies all existing SQL migrations to your database schema and tracks changes in `_prisma_migrations`:

```bash
npx prisma migrate dev
```

> **Note:** If you are configuring a clean development database and want to sync the schema without generating migration files, you can alternately run:
> ```bash
> npx prisma db push
> ```

---

## 5. Seeding Test Venues & Mock Data

WorkSphere includes a database seeding script (`prisma/seed.js`) that populates your local database with mock workspaces, desks, noise levels, WiFi ratings, and venue amenities:

```bash
npx prisma db seed
```

Upon completion, you will see a confirmation message indicating test venues, desks, and initial admin records have been populated.

---

## 6. Inspecting Data with Prisma Studio

To visually explore, query, and edit records in your browser:

```bash
npx prisma studio
```

This launches a web-based database management GUI at [http://localhost:5555](http://localhost:5555).

---

## 7. Troubleshooting & Common Connection Errors

### Error: `P1001: Can't reach database server at localhost:5432`
- **Cause:** PostgreSQL service is stopped or listening on another port.
- **Fix:**
  - Verify PostgreSQL status:
    - *macOS:* `brew services list`
    - *Linux:* `sudo systemctl status postgresql`
    - *Windows:* Check Windows Services (`services.msc`) -> `postgresql-x64-15`.
  - Check if port 5432 is open: `nc -zv localhost 5432` or `Test-NetConnection -Port 5432 localhost`.

### Error: `P1000: Authentication failed against database server`
- **Cause:** Incorrect username or password in `DATABASE_URL`.
- **Fix:**
  - Test connecting manually: `psql -U worksphere -d worksphere -h localhost -W`
  - Ensure password special characters are URL-encoded in `DATABASE_URL` (e.g., replace `@` with `%40`).

### Error: `permission denied for schema public`
- **Cause:** PostgreSQL 15 tightened default permissions on the `public` schema.
- **Fix:**
  ```sql
  psql -U postgres -d worksphere -c "GRANT ALL ON SCHEMA public TO worksphere;"
  ```

### Resetting Local Database
If your local database schema enters a conflicted or corrupted state during feature testing:

```bash
npx prisma migrate reset
```
*Warning: This drops the database, recreates it, applies all migrations, and automatically re-runs the seed script.*
