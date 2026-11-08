# WorkSphere Developer Troubleshooting Guide

This guide provides beginner-friendly troubleshooting steps for common local development problems encountered when running `WorkSphere`.

---

## 📋 Quick Reference: Common Development Issues

| Problem Area | Common Symptom | Primary Solution / Command |
| :--- | :--- | :--- |
| **1. Missing Environment Variables** | App crashes on boot, `Clerk: Secret key is missing` | `cp .env.example .env.local` & fill required keys |
| **2. Dependency Errors** | `npm ERR! ERESOLVE`, peer dependency failure | `npm install --legacy-peer-deps` |
| **3. Database Connection** | `PrismaClientInitializationError`, `P1001` | `docker compose up -d` or verify `DATABASE_URL` |
| **4. Prisma Migration** | `Drift detected`, missing Prisma model types | `npx prisma generate` or `npx prisma db push` |
| **5. Dev Server Startup** | Server compilation failure, stale `.next` cache | `rm -rf .next` && `npx tsc --noEmit` |
| **6. Port Conflicts** | `EADDRINUSE: address already in use :::3000` | `lsof -i :3000` or `PORT=3001 npm run dev` |
| **7. Authentication (Clerk)** | `401 Unauthorized`, invalid secret key | Verify Clerk keys in `.env.local` & restart dev server |

---

## 1. Missing Environment Variables

### Symptoms / Error
- The application crashes immediately upon starting (`npm run dev`).
- Server error in terminal: `Clerk: Secret key is missing or invalid` or `Environment variable DATABASE_URL is not set`.
- API endpoints return `500 Internal Server Error` or fail silently.

### Possible Causes
- `.env.local` file is missing in the project root directory.
- Variable names are misspelled or missing required values defined in `.env.example`.
- Environment variables were added or updated while the Next.js dev server was already running without a server restart.
- Values in `.env.local` contain outer quotes formatted incorrectly or extra spaces around the `=` sign.

### Step-by-Step Solution
1. **Create `.env.local` from the template file:**
   - **macOS / Linux / Git Bash:**
     ```bash
     cp .env.example .env.local
     ```
   - **Windows (PowerShell):**
     ```powershell
     Copy-Item .env.example .env.local
     ```
   - **Windows (CMD):**
     ```cmd
     copy .env.example .env.local
     ```
2. **Configure mandatory variables in `.env.local`:**
   ```env
   DATABASE_URL="postgresql://worksphere:worksphere@localhost:5432/worksphere"
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
   CLERK_SECRET_KEY="sk_test_..."
   NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
   NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
   GROQ_API_KEY="gsk_..."
   ```
3. **Verify variable formatting:** Ensure variable names match `.env.example` exactly and contain no trailing whitespace.
4. **Restart the development server:** Stop `npm run dev` (`Ctrl+C`) and start it again so Next.js reloads `.env.local`.

### Relevant Commands
```bash
cp .env.example .env.local
npm run dev
```

---

## 2. Dependency Installation Errors

### Symptoms / Error
- `npm ERR! code ERESOLVE` or `unable to resolve dependency tree`.
- Node engine warnings: `npm ERR! engine Unsupported engine`.
- Build failures during native dependency compilation (e.g. `circom2`, `wabt`, `lightningcss`, `swc`).

### Possible Causes
- Running an incompatible Node.js version. WorkSphere requires **Node.js 18+** (Node.js 20 LTS recommended).
- Strict peer dependency resolution in `npm` version 7+.
- Corrupted `node_modules` directory or stale `package-lock.json`.

### Step-by-Step Solution
1. **Verify your Node.js version:**
   ```bash
   node -v
   ```
2. **Switch to Node.js 20 using NVM (Node Version Manager):**
   ```bash
   nvm use 20
   ```
   *If Node 20 is not installed:*
   ```bash
   nvm install 20 && nvm use 20
   ```
3. **Install dependencies with legacy peer dependency resolution:**
   ```bash
   npm install --legacy-peer-deps
   ```
4. **If installation still fails, perform a clean reinstall:**
   - **macOS / Linux / Git Bash:**
     ```bash
     rm -rf node_modules package-lock.json
     npm install --legacy-peer-deps
     ```
   - **Windows (PowerShell):**
     ```powershell
     Remove-Item -Recurse -Force node_modules, package-lock.json
     npm install --legacy-peer-deps
     ```

### Relevant Commands
```bash
node -v
nvm use 20
npm install --legacy-peer-deps
```

---

## 3. Database Connection Errors

### Symptoms / Error
- `PrismaClientInitializationError: Can't reach database server at localhost:5432`.
- `P1001: Can't reach database server` or `P1002: Connection timed out`.
- Connection refused (`ECONNREFUSED 127.0.0.1:5432`) or SSL mode errors.

### Possible Causes
- Local PostgreSQL service or Docker container is not running.
- `DATABASE_URL` connection string in `.env.local` has incorrect credentials, hostname, or port.
- Missing `?sslmode=require` query parameter when connecting to remote databases (e.g. Neon, Supabase).

### Step-by-Step Solution
1. **If using Docker Compose (Recommended):**
   Start the PostgreSQL and Redis containers:
   ```bash
   docker compose up -d
   ```
   Check container health status:
   ```bash
   docker compose ps
   ```
2. **If using native PostgreSQL installed locally:**
   Ensure PostgreSQL server service is active:
   - **macOS (Homebrew):** `brew services list`
   - **Linux:** `sudo systemctl status postgresql`
   - **Windows:** Check the Services management window (`services.msc`) for PostgreSQL service status.
3. **Check `DATABASE_URL` format in `.env.local`:**
   - **Local Docker Postgres:**
     ```env
     DATABASE_URL="postgresql://worksphere:worksphere@localhost:5432/worksphere"
     ```
   - **Neon Cloud Postgres:**
     ```env
     DATABASE_URL="postgresql://user:password@ep-name.us-east-2.aws.neon.tech/neondb?sslmode=require"
     ```
4. **Verify database connection with Prisma Studio:**
   ```bash
   npx prisma studio
   ```

### Relevant Commands
```bash
docker compose up -d
docker compose ps
npx prisma studio
```

---

## 4. Prisma Migration Errors

### Symptoms / Error
- Terminal warning: `Drift detected: Your database schema is not in sync with your migration history`.
- `P3005: The database schema for public is not empty` or `P3009: migrate found failed migrations`.
- TypeScript errors: `Property 'xyz' does not exist on type 'PrismaClient'`.

### Possible Causes
- Switching Git branches that contain different database migrations.
- Modifying `prisma/schema.prisma` without regenerating the Prisma Client.
- Manual changes applied to the database schema outside of Prisma migrations.

### Step-by-Step Solution
1. **Check current migration status:**
   ```bash
   npx prisma migrate status
   ```
2. **Regenerate Prisma Client type definitions:**
   Run this whenever `schema.prisma` changes or after switching branches:
   ```bash
   npx prisma generate
   ```
3. **Synchronize database schema directly (for local development):**
   ```bash
   npx prisma db push
   ```
4. **Reset local database (if unrecoverable schema drift occurs):**
   ```bash
   npx prisma migrate reset
   ```
   *Warning: This drops local database tables, applies all migrations, and runs `npx prisma db seed`.*
5. **Mark a manually applied migration as resolved (if applicable):**
   ```bash
   npx prisma migrate resolve --applied <migration_name>
   ```

### Relevant Commands
```bash
npx prisma migrate status
npx prisma generate
npx prisma db push
npx prisma migrate reset
```

---

## 5. Development Server Startup Issues

### Symptoms / Error
- `npm run dev` exits immediately or hangs indefinitely during compilation.
- Stale hot-reloading errors or missing bundle files.
- TypeScript compiler compilation failures on startup.

### Possible Causes
- Corrupted `.next` build cache directory.
- TypeScript syntax errors or broken imports across project files.
- Stale process or file watcher deadlock.

### Step-by-Step Solution
1. **Run TypeScript compiler check (dry run):**
   ```bash
   npx tsc --noEmit
   ```
   Address any reported type or import errors.
2. **Clear the Next.js build cache directory `.next`:**
   - **macOS / Linux / Git Bash:**
     ```bash
     rm -rf .next
     ```
   - **Windows (PowerShell):**
     ```powershell
     Remove-Item -Recurse -Force .next
     ```
   - **Windows (CMD):**
     ```cmd
     rmdir /s /q .next
     ```
3. **Run code quality linting:**
   ```bash
   npm run lint
   ```
4. **Restart the Next.js development server:**
   ```bash
   npm run dev
   ```

### Relevant Commands
```bash
npx tsc --noEmit
npm run lint
npm run dev
```

---

## 6. Port Conflicts

### Symptoms / Error
- `Error: listen EADDRINUSE: address already in use :::3000`
- `Port 3000 is already in use.`
**Solution:**

* Ensure you have created a `.env.local` file in the root directory.
* Copy the template from `.env.example`: `cp .env.example .env.local`
* On **Windows**, use: `copy .env.example .env.local`
* Verify that no variable strings are accidentally wrapped in extra quotes unless explicitly required.
* See [`docs/ENV_VARS.md`](ENV_VARS.md) for a complete list of every variable with descriptions.

## 3. Dependency Installation Errors

**Symptom:** `npm install` fails with peer dependency conflicts or missing native modules.

**Solution:**

1. Delete `node_modules` and the lock file, then reinstall:

   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. If you see `ERESOLVE` peer dependency warnings, they are usually safe to ignore. Do **not** use `--force` or `--legacy-peer-deps` unless the README explicitly says to.

3. On Apple Silicon (M1/M2/M3), ensure you're running the `arm64` version of Node, not x86 under Rosetta.

## 4. Prisma & Database Connection

### Possible Causes
- An existing Next.js server instance or another background application is actively running on port `3000`.

### Step-by-Step Solution

#### Option A: Terminate the process using port 3000
- **macOS / Linux / Git Bash:**
  ```bash
  lsof -i :3000
  kill -9 <PID>
  ```
- **Windows (PowerShell):**
  ```powershell
  Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
  Stop-Process -Id <PID> -Force
  ```
- **Windows (CMD):**
  ```cmd
  netstat -ano | findstr :3000
  taskkill /PID <PID> /F
  ```
* Verify your `DATABASE_URL` in `.env.local` is correct and the database server is running.
* If you're using Neon, make sure `?sslmode=require` is at the end of the connection string.
* Regenerate the Prisma client after pulling new schema changes:

#### Option B: Start the Next.js dev server on an alternative port
- **macOS / Linux / Git Bash:**
  ```bash
  PORT=3001 npm run dev
  ```
- **Windows (PowerShell):**
  ```powershell
  $env:PORT=3001; npm run dev
  ```
- **Windows (CMD):**
  ```cmd
  set PORT=3001 && npm run dev
  ```

### Relevant Commands
```bash
lsof -i :3000
PORT=3001 npm run dev
```
* If you see migration drift errors:

  ```bash
  npx prisma migrate dev
  ```

## 5. Development Server Startup Issues

**Symptom:** `npm run dev` fails immediately or hangs without output.

**Solution:**

1. Make sure dependencies are installed: `npm install`
2. Regenerate the Prisma client: `npx prisma generate`
3. Delete the build cache: `rm -rf .next`
4. Try again: `npm run dev`

If the server hangs on Turbopack, remove the `--turbo` flag from the `dev` script in `package.json` temporarily.

## 6. Port Conflicts

**Symptom:** `Error: listen EADDRINUSE: address already in use :::3000`

**Solution:**

* Another process is using port 3000. Find and kill it:

  ```bash
  # Linux/macOS
  lsof -i :3000 | grep LISTEN
  kill -9 <PID>

  # Windows
  netstat -ano | findstr :3000
  taskkill /PID <PID> /F
  ```

* Or start the dev server on a different port: `PORT=3001 npm run dev`

## 7. Authentication Configuration Issues (Clerk)

**Symptom:** Sign-in page shows a Clerk error, or API routes return `401 Unauthorized`.

**Solution:**

1. Verify you have both keys set in `.env.local`:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...`
   - `CLERK_SECRET_KEY=sk_test_...`

2. Make sure the keys are from the **same Clerk application** and the **same mode** (both test or both production).

3. Verify the sign-in/sign-up URLs match your Clerk dashboard:
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`

4. Restart the dev server after any `.env.local` change — Next.js does not hot-reload env vars.

---

## 7. Authentication Configuration Issues (Clerk)

### Symptoms / Error
- Terminal error: `Clerk: Secret key is missing or invalid`.
- Browser console error: `@clerk/nextjs: Missing publishable key`.
- API route requests return `401 Unauthorized`.
- Infinite redirect loops or blank pages on `/sign-in` or `/sign-up`.

### Possible Causes
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` or `CLERK_SECRET_KEY` missing, invalid, or swapped in `.env.local`.
- Accidental mixing of Clerk production keys with local development URLs.
- Sign-in or sign-up redirect URLs (`NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL`) missing or misconfigured.
- Environment variables modified without restarting the dev server.

### Step-by-Step Solution
1. **Retrieve API keys from Clerk Dashboard:**
   Log into [clerk.com](https://clerk.com) -> API Keys section.
2. **Verify `.env.local` settings:**
   ```env
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
   CLERK_SECRET_KEY="sk_test_..."
   NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
   NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
   ```
   *Ensure the publishable key (`pk_test_...`) is public and secret key (`sk_test_...`) is private.*
3. **Restart the Next.js development server:**
   Environment variables are loaded on boot. Stop `npm run dev` (`Ctrl+C`) and start it again.
4. **Clear browser session data:**
   Clear cookies and localStorage for `http://localhost:3000` to reset any stuck authentication sessions.

### Relevant Commands
```bash
npm run dev
```

---

## ❓ Frequently Asked Questions (FAQ)

### 1. How do I fix Database Seed errors?
**Error:** `Unique constraint failed on the fields: (id)` during `npx prisma db seed`.  
**Fix:** This occurs when trying to seed data into a database that already contains records. Run `npx prisma migrate reset` to clean and re-seed the local database, or comment out conflicting record creations in `prisma/seed.js`.

### 2. How do I resolve Turbopack build issues?
**Error:** Next.js fails to compile modules when using Turbopack.  
**Fix:** Delete `.next` directory (`rm -rf .next`) and restart the dev server. WorkSphere configures standard Webpack by default via `npm run dev` (`next dev --webpack`).

---

## 📚 Related Documentation
- [WorkSphere Beginner Setup Guide](BEGINNER_SETUP_GUIDE.md)
- [Prisma Troubleshooting Guide](PRISMA_TROUBLESHOOTING.md)
- [Environment Variables Documentation](ENV_VARS.md)
- [Contributing Guidelines](../CONTRIBUTING.md)

