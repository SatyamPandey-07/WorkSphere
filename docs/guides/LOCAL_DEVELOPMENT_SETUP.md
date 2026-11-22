# 🐳 Local Development Setup Guide: Docker, PostgreSQL & Redis

This guide walks first-time contributors through setting up the complete local database and caching infrastructure for **WorkSphere** using Docker Compose. Following these steps ensures your local environment mirrors production without needing external cloud database subscriptions.

---

## 📋 Prerequisites

Before starting, ensure you have the following installed on your machine:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS, Windows, or Linux) with Docker Compose v2+.
- [Node.js](https://nodejs.org/) v20.x or v22.x LTS.
- [npm](https://www.npmjs.com/) v10+.
- [Git](https://git-scm.com/).

Verify installation:

```bash
docker --version
docker compose version
node -v
npm -v
```

---

## 🚀 1-Command Database & Cache Orchestration

WorkSphere includes a pre-configured `docker-compose.yml` defining:

- **PostgreSQL 16** with pgvector and the additional required extensions, using the repository-provided extension-enabled Docker image.
- **Redis 7** Alpine for high-speed rate-limiting, session tokens, and caching.

Run the containers in detached mode:

```bash
docker compose -f docker-compose.yml -f .github/test-postgres/compose.override.yml up -d --build --wait
```

Verify that the containers are healthy and running:

```bash
docker compose -f docker-compose.yml -f .github/test-postgres/compose.override.yml ps
```

You should see:

```text
NAME                  IMAGE                        STATUS         PORTS
worksphere-postgres   worksphere-postgres-test:local       Up             0.0.0.0:5432->5432/tcp
worksphere-redis      redis:7-alpine               Up             0.0.0.0:6379->6379/tcp
```

---

## Required PostgreSQL Extensions

The default `postgres:16-alpine` image does not include all extension binaries required by WorkSphere.

Use the repository-provided Docker Compose override. It builds an extension-enabled PostgreSQL 16 image using `.github/test-postgres/Dockerfile`.

WorkSphere requires these PostgreSQL extensions:

- `vector`
- `pg_trgm`
- `postgis`
- `fuzzystrmatch`

After starting the containers, enable the extensions:

```bash
docker compose -f docker-compose.yml -f .github/test-postgres/compose.override.yml exec -T postgres psql -U worksphere -d worksphere_dev -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" -c "CREATE EXTENSION IF NOT EXISTS postgis;" -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;"
```

---

## ⚙️ Environment Configuration (`.env.local`)

Copy the sample environment file or create `.env.local` in the project root:

```bash
cp .env.example .env.local
```

Ensure the following connection strings match the Docker Compose service definitions:

```env
# PostgreSQL Database (Docker pgvector)
DATABASE_URL="postgresql://worksphere:worksphere_dev_password@localhost:5432/worksphere_dev?schema=public"
DIRECT_URL="postgresql://worksphere:worksphere_dev_password@localhost:5432/worksphere_dev?schema=public"

# Redis Cache (Docker Redis 7)
REDIS_URL="redis://localhost:6379"

# Local Next.js App
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="worksphere-dev-secret-key-12345"
```

---

## 🗄️ Database Initialization & Migrations

Once your Postgres container is running, initialize the database schema and push Prisma migrations:

### 1. Generate the Prisma Client

```bash
npx prisma generate
```

### 2. Push Database Schema

Push the schema directly to your local Postgres instance:

```bash
npx prisma db push
```

### 3. Seed Development Data (Optional but Recommended)

Populate your local database with mock workspaces, cafes, and amenities:

```bash
npm run db:seed
```

---

## 🔍 Validating Local Database Connection

To verify that your local Postgres and Redis instances are accepting connections:

### Test PostgreSQL via Prisma Studio:

```bash
npx prisma studio
```

Open [http://localhost:5555](http://localhost:5555) in your browser to inspect database tables and seed rows.

### Test Redis Connectivity:

```bash
docker exec -it worksphere-redis redis-cli ping
```

Expected output:

```text
PONG
```

---

## 🛠️ Troubleshooting & OS-Specific Port Collisions

### 1. Port 5432 (Postgres) or 6379 (Redis) Already in Use

If you have a native PostgreSQL or Redis service running locally on your OS, Docker will fail to bind to port 5432 or 6379 (`address already in use`).

#### On Windows:

Find the process occupying the port:

```cmd
netstat -ano | findstr :5432
```

Stop the local PostgreSQL service:

```cmd
net stop postgresql-x64-16
```

Or temporarily stop native Redis:

```cmd
net stop Redis
```

#### On macOS / Linux:

Check which PID is using the port:

```bash
sudo lsof -i :5432
sudo lsof -i :6379
```

Stop the native service:

```bash
# macOS (Homebrew)
brew services stop postgresql@16
brew services stop redis

# Linux (systemd)
sudo systemctl stop postgresql
sudo systemctl stop redis
```

#### Alternative: Custom Host Port Mapping

If you cannot stop your native service, you can change the host port mapping in `docker-compose.yml`:

```yaml
ports:
  - "5433:5432" # Maps host port 5433 to container port 5432
```

And update `.env.local`:

```env
DATABASE_URL="postgresql://worksphere:worksphere_dev_password@localhost:5433/worksphere_dev?schema=public"
```

---

## 🛑 Teardown & Reset Commands

To stop the containers without losing data:

```bash
docker compose -f docker-compose.yml -f .github/test-postgres/compose.override.yml stop
```

To stop and remove containers (preserving persistent volumes):

```bash
docker compose -f docker-compose.yml -f .github/test-postgres/compose.override.yml down
```

To perform a complete clean reset (wiping all local database and Redis volumes):

```bash
docker compose -f docker-compose.yml -f .github/test-postgres/compose.override.yml down -v
docker compose -f docker-compose.yml -f .github/test-postgres/compose.override.yml up -d --build --wait
npx prisma db push
npm run db:seed
```
