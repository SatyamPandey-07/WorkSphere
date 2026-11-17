# WorkSphere Getting Started & Environment Setup Guide

Welcome to the WorkSphere contributor guide! This document provides an explicit prerequisite checklist, version compatibility matrix, environment manager setup (`nvm` / `fnm`), PostgreSQL configuration, and troubleshooting steps for setting up WorkSphere locally.

---

## 1. Prerequisites & Version Matrix

To avoid engine mismatch errors or missing database vector extensions, verify that your local system matches or exceeds the required version thresholds:

| Dependency | Minimum Version | Recommended Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v22.0.0` | `v22.14.0 LTS` | Server-side runtime (Next.js 16 engine requirement) |
| **npm** | `v10.0.0` | `v10.9.0+` | Package manager (bundled with Node 22) |
| **PostgreSQL** | `v16.0` | `v16.4+` | Relational database engine |
| **pgvector** | `v0.5.0` | `v0.7.0+` | Vector similarity extension for AI embeddings |
| **Git** | `v2.40.0` | `v2.45.0+` | Version control |

---

## 2. Setting Up Node.js 22 with Version Managers

We strongly recommend using a Node version manager (`nvm` or `fnm`) to switch to Node.js 22 automatically.

### 2.1 macOS & Linux (via `nvm`)

1. **Install or update Node 22**:
   ```bash
   nvm install 22
   ```

2. **Use Node 22 in current terminal session**:
   ```bash
   nvm use 22
   ```

3. **Set Node 22 as default runtime**:
   ```bash
   nvm alias default 22
   ```

4. **Verify active Node and npm versions**:
   ```bash
   node --version  # Should output v22.x.x
   npm --version   # Should output 10.x.x
   ```

---

### 2.2 Windows Setup

#### Option A: nvm-windows
1. Download and install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases).
2. Open PowerShell or Command Prompt as Administrator:
   ```powershell
   nvm install 22.14.0
   nvm use 22.14.0
   ```
3. Confirm installation:
   ```powershell
   node -v
   ```

#### Option B: Fast Node Manager (`fnm`)
```powershell
winget install Schniz.fnm
fnm install 22
fnm use 22
```

---

## 3. PostgreSQL 16 & `pgvector` Setup

WorkSphere relies on PostgreSQL 16 and `pgvector` for storing venue metadata, user sessions, and 1024-dimensional AI vector embeddings.

### Option A: Docker (Fastest for Local Development)

Run PostgreSQL 16 with pre-configured `pgvector` in a background container:

```bash
docker run --name worksphere-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=worksphere \
  -p 5432:5432 \
  -d pgvector/pgvector:pg16
```

Define connection string in `.env.local`:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/worksphere"
```

---

### Option B: macOS via Homebrew

```bash
# Install PostgreSQL 16 and pgvector
brew install postgresql@16 pgvector

# Start PostgreSQL background service
brew services start postgresql@16

# Create local database
createdb worksphere

# Enable pgvector extension
psql -d worksphere -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

---

### Option C: Ubuntu / Debian Linux

```bash
# Install PostgreSQL 16 and pgvector
sudo apt-get update
sudo apt-get install -y postgresql-16 postgresql-16-pgvector

# Start database service
sudo systemctl start postgresql

# Create database and enable vector extension
sudo -u postgres psql -c "CREATE DATABASE worksphere;"
sudo -u postgres psql -d worksphere -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

---

### Option D: Cloud Database (Neon.tech - Recommended)

1. Sign up at [Neon.tech](https://neon.tech/) and create a PostgreSQL 16 project (`pgvector` is pre-enabled).
2. Copy the connection string into `.env.local`:
   ```env
   DATABASE_URL="postgresql://user:password@ep-sample.us-east-2.aws.neon.tech/neondb?sslmode=require"
   ```

---

## 4. WorkSphere Project Initialization

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Janvi-kapoor/WorkSphere.git
   cd WorkSphere
   ```

2. **Configure environment variables**:
   Create a `.env.local` file by copying the template:
   ```bash
   cp .env.example .env.local
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Initialize Prisma schema & client**:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

5. **Start local development server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

## 5. Troubleshooting & Common Errors

### Error 1: `ERR_ENGINE_UNSUPPORTED` or Node Version Mismatch
```text
error worksphere@0.1.0: The engine "node" is incompatible with this module.
Expected version ">=22.0.0". Got "20.11.0".
```
- **Cause**: Active Node.js runtime is older than Node.js 22.
- **Fix**: Run `nvm use 22` or `fnm use 22`. Verify active version with `node -v`.

---

### Error 2: `type "vector" does not exist`
```text
PrismaClientKnownRequestError: Failed to prepare query: type "vector" does not exist
```
- **Cause**: The PostgreSQL database does not have the `pgvector` extension enabled.
- **Fix**: Connect to your database via `psql` or database GUI and execute:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```

---

### Error 3: `PrismaClientInitializationError: Failed to connect to database`
- **Cause**: Database service is stopped or `DATABASE_URL` credentials in `.env.local` are incorrect.
- **Fix**: Ensure PostgreSQL/Docker container is running (`docker ps` or `brew services list`). Check host port `5432`.
---

### Error 4: Docker Compose PostgreSQL fails to start

Check the service status and logs:

```bash
docker compose ps
docker compose logs postgres
```

Start the services:

```bash
docker compose up -d
```

- **Cause:** Docker Desktop may not be running, the image may have failed to download, or PostgreSQL initialization may have failed.
- **Fix:** Start Docker Desktop, inspect the logs, resolve the reported error, and retry.

### Error 5: Port 5432 is already in use

- **Cause:** Another PostgreSQL instance or application is using port `5432`.

On Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen
```

Inspect the process using its PID:

```powershell
Get-Process -Id <PID>
```
Replace `<PID>` with the numeric process ID returned by the previous command.

Alternatively, change the host port mapping in `docker-compose.yml`:

```yaml
ports:
  - "5433:5432"
```

Update the host port in `DATABASE_URL` to `5433`. The PostgreSQL container continues listening on port `5432`.

### Error 6: `extension "vector" is not available`

- **Cause:** The PostgreSQL image does not contain pgvector extension binaries.
- **Fix:** Use a PostgreSQL image or custom image that includes pgvector and matches the PostgreSQL server version.

The root Compose file currently uses `postgres:16-alpine`, which does not include pgvector by default.

**Important:** WorkSphere requires `vector`, `pg_trgm`, and `postgis`. Its migrations also use `fuzzystrmatch`. A pgvector-only image is not necessarily sufficient. Verify that your selected image supports all four extensions.

Once the required extension binaries are available, enable them in the database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
```

### Error 7: PostgreSQL volume permission or initialization errors

- **Cause:** PostgreSQL cannot access its data directory because of incorrect filesystem permissions, incompatible bind mounts, or initialization problems.

Inspect logs and volumes:

```bash
docker compose logs postgres
docker volume ls
docker volume inspect <actual-volume-name>
```

- Prefer Docker-managed named volumes for local PostgreSQL data.
- On Linux or WSL2, verify that mounted directories are accessible to the container.
- On Windows, avoid manually changing permissions on PostgreSQL's internal data directory.
- Do not delete database volumes as a routine troubleshooting step. This can permanently remove local database data.

### PostgreSQL health check and extension validation

Check service health:

```bash
docker compose ps
```

Check PostgreSQL readiness:

```bash
docker compose exec postgres pg_isready -U worksphere -d worksphere_dev
```

Expected output:

```text
/var/run/postgresql:5432 - accepting connections
```

Inspect installed extensions:

```bash
docker compose exec postgres psql -U worksphere -d worksphere_dev -c "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
```

A successful health check confirms database readiness, not that every required extension is installed.

### Windows: Docker Desktop, WSL2, and native terminals

Docker Desktop can be controlled from Windows PowerShell or a WSL2 Linux terminal. These are different terminal environments connecting to the Docker Desktop engine. Enable WSL integration when running Docker commands inside a WSL2 distribution.

**Docker Desktop with WSL2:**

- Install and start Docker Desktop.
- Enable the WSL2-based engine in Docker Desktop settings.
- Enable integration for your Linux distribution under WSL integration settings.
- Check WSL configuration:

```powershell
wsl --status
wsl --list --verbose
```

**Windows PowerShell:**

- Docker commands use the Docker Desktop engine.
- Ensure Docker Desktop is running.
- If `docker` is not recognized, verify the installation and reopen PowerShell.

**WSL2 filesystem advice:**

- Keep Linux-based development projects in the WSL Linux filesystem for better bind-mount performance.
- Prefer Docker-managed named volumes for PostgreSQL data.
- Avoid manually modifying PostgreSQL container data-directory permissions from Windows.

For additional guidance, see the official [Docker Desktop WSL documentation](https://docs.docker.com/desktop/features/wsl/) and [WSL best practices](https://docs.docker.com/desktop/features/wsl/best-practices/).

### macOS: Docker Desktop and PostgreSQL troubleshooting

**Docker Desktop for Mac:**
- Install and start Docker Desktop for Mac.
- Run Docker commands from the macOS Terminal.
- Check that Docker is running:
```bash
open -a Docker
docker info
```

**Port 5432 already in use:**
Check which process is using the port:
```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN
```
- Stop the conflicting service if appropriate, or change the host port mapping to `5433:5432` in `docker-compose.yml`.
- Update the host port in `DATABASE_URL` if you change the port.

**Volumes and file access:**
- Prefer Docker-managed named volumes for PostgreSQL data.
- Avoid manually modifying PostgreSQL container data-directory permissions.
- Do not delete database volumes unless you intentionally want to remove their data.

For more information, see the official [Docker Desktop for Mac documentation](https://docs.docker.com/desktop/setup/install/mac-install/).
