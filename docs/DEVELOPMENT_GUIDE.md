# WorkSphere Development & Local Docker Setup Guide

This guide provides step-by-step instructions for setting up WorkSphere's development environment locally using **Docker Compose** for PostgreSQL (with `pgvector` support) and Redis.

Running your database and cache in Docker containers ensures consistent development environments across macOS, Linux, and Windows without installing system-wide database daemons.

---

## Prerequisites

Before starting, ensure you have installed:

- **Node.js**: v18.0.0 or newer (v20 LTS recommended).
- **npm**: v9.0.0 or newer.
- **Docker Desktop**: Docker Engine 20.10+ and Docker Compose v2+.
- **Git**: For cloning and managing branches.

---

## 1. Local Infrastructure with Docker Compose

WorkSphere includes a pre-configured `docker-compose.yml` in the project root containing PostgreSQL (with `pgvector` extension) and Redis 7.

### Example `docker-compose.yml`

If you are setting up Docker manually or creating a custom setup, use the configuration below:

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: worksphere-postgres
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgrespassword
      POSTGRES_DB: worksphere
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: worksphere-redis
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

### Starting Docker Services

To launch PostgreSQL and Redis in detached (background) mode, run:

```bash
docker compose up -d
```

Verify that both containers are running and healthy:

```bash
docker compose ps
```

---

## 2. Configuring `.env.local`

Create a `.env.local` file in the project root and point `DATABASE_URL` to your Docker PostgreSQL container:

```env
# Database (Docker PostgreSQL container)
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/worksphere?schema=public"

# Clerk Authentication (Get free development keys from clerk.com)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
WEBHOOK_SECRET="whsec_..."
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"

# Groq AI Engine (Get free API key from console.groq.com)
GROQ_API_KEY="gsk_..."

# Application URL
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

---

## 3. Database Migrations & Initial Data Seeding

Once the Docker containers are healthy and `.env.local` is configured, set up your database schema and seed initial sample data.

### Step 1: Generate Prisma Client

```bash
npx prisma generate
```

### Step 2: Apply Database Schema & Migrations

For initial local setup, push the Prisma schema directly to your local Docker database:

```bash
npx prisma db push
```

Alternatively, to execute formal Prisma migration files:

```bash
npx prisma migrate dev
```

### Step 3: Seed Initial Sample Data

Populate your local database with sample workspace venues, amenities, reviews, and test users:

```bash
npx prisma db seed
```

---

## 4. Running the Development Server

Start the Next.js local development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to verify the application is running.

---

## 5. Troubleshooting & Common Issues

### Issue 1: PostgreSQL Port 5432 Conflict

**Error:** `Error starting userland proxy: listen tcp4 0.0.0.0:5432: bind: address already in use`

**Root Cause:** A local PostgreSQL instance (or another container) is already running on your host machine on port 5432.

**Resolution:**
- **Option A (Stop local service)**:
  - **Linux**: `sudo systemctl stop postgresql`
  - **macOS (Homebrew)**: `brew services stop postgresql`
  - **Windows**: Stop the `postgresql-x64` service via `services.msc` or PowerShell: `Stop-Service postgresql*`
- **Option B (Change host port in `docker-compose.yml`)**:
  Update the port mapping to `"5433:5432"`:
  ```yaml
  ports:
    - "5433:5432"
  ```
  Then update `DATABASE_URL` in `.env.local`:
  ```env
  DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5433/worksphere?schema=public"
  ```

---

### Issue 2: Redis Port 6379 Conflict

**Error:** `Error starting userland proxy: listen tcp4 0.0.0.0:6379: bind: address already in use`

**Resolution:**
- Stop existing host Redis service:
  - **Linux**: `sudo systemctl stop redis`
  - **macOS**: `brew services stop redis`
- Or remap host port in `docker-compose.yml` to `"6380:6379"`.

---

### Issue 3: Prisma `Can't reach database server` Error

**Error:** `PrismaClientInitializationError: Can't reach database server at localhost:5432`

**Resolution:**
1. Check container health status: `docker compose ps`
2. View container logs to inspect startup errors:
   ```bash
   docker compose logs postgres
   ```
3. Ensure Docker Desktop is running and healthy.

---

### Useful Docker Utility Commands

| Command | Purpose |
| :--- | :--- |
| `docker compose up -d` | Start PostgreSQL & Redis containers in background |
| `docker compose down` | Stop containers (preserves volume data) |
| `docker compose down -v` | Stop containers AND delete volume data (reset database) |
| `docker compose logs -f postgres` | Stream live logs from PostgreSQL container |
| `docker compose ps` | Check health status of all running services |
