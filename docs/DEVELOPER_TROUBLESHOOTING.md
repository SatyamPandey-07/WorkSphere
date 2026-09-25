# Developer Troubleshooting Guide

This guide covers common local environment setup errors and their solutions to help you get the `WorkSphere` repository running smoothly.

---

## 1. Node.js Version Mismatches

**Symptom:** You encounter syntax errors on startup, or packages fail to install with `npm install`.

**Solution:** Ensure you are running the project's supported Node.js version. The project requires **Node.js 20+**.

* We recommend using [NVM (Node Version Manager)](https://github.com/nvm-sh/nvm).
* Run `nvm use` in the root directory to automatically switch to the version specified in the project's `.nvmrc` file.
* To install the correct version: `nvm install 20 && nvm use 20`

## 2. Environment Variable Issues

**Symptom:** The application crashes immediately on startup, or API calls fail silently.

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

**Symptom:** `PrismaClientInitializationError` or errors stating the database cannot be reached.

**Solution:**

* Verify your `DATABASE_URL` in `.env.local` is correct and the database server is running.
* If you're using Neon, make sure `?sslmode=require` is at the end of the connection string.
* Regenerate the Prisma client after pulling new schema changes:

  ```bash
  npx prisma generate
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

## FAQ

### 1. How do I fix Database Seed errors?

**Error:** `Unique constraint failed on the fields: (id)` during `npx prisma db seed`.

**Fix:** This usually happens if you try to seed a database that already contains the initial data. You can either wipe your local database using `npx prisma migrate reset` (which will also run the seed automatically), or comment out the specific creation blocks in your `seed.ts` file that are causing the collision.

### 2. Why are my Clerk API Keys throwing 401 Unauthorized errors?

**Error:** Authentication fails, or the terminal shows `Clerk: Secret key is missing or invalid`.

**Fix:**

1. Log into your Clerk dashboard and double-check your `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
2. Ensure you have not accidentally swapped the test mode keys with production keys.
3. Restart your Next.js development server, as changes to `.env` files require a hard restart.

### 3. How do I resolve Turbopack build issues?

**Error:** Next.js (Turbopack) fails to compile specific modules or hangs indefinitely.

**Fix:** Turbopack caching can sometimes become corrupted during aggressive hot-reloading or branch switching.

1. Delete the `.next` directory: `rm -rf .next`
2. Restart the development server.
3. If the issue persists, try running the standard Webpack bundler temporarily by removing the `--turbo` flag from your `dev` script in `package.json`.
