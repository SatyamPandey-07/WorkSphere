# Developer Troubleshooting Guide
This guide covers common local environment setup errors and their solutions to help you get the `WorkSphere` repository running smoothly.
---
## 1. Node.js Version Mismatches
**Symptom:** You encounter syntax errors on startup, or packages fail to install with `npm install`.
**Solution:** Ensure you are running the project's supported Node.js version. 
* We recommend using [NVM (Node Version Manager)](https://github.com/nvm-sh/nvm).
* Run `nvm use` in the root directory to automatically switch to the version specified in the project's `.nvmrc` file.
## 2. Environment Variable Issues (`env vars`)
**Symptom:** The application crashes immediately on startup, or API calls fail silently.
**Solution:** 
* Ensure you have created a `.env.local` or `.env` file in the root directory.
* Copy the template from `.env.example`: `cp .env.example .env.local`
* Verify that no variable strings are accidentally wrapped in extra quotes unless explicitly required.
## 3. Prisma & Database Connection
**Symptom:** `PrismaClientInitializationError` or errors stating the database cannot be reached.
**Solution:**
* Verify your `DATABASE_URL` in the `.env` file is correct and the database server is running.
* If schema types are missing, regenerate the Prisma client by running:
  ```bash
  npx prisma generate
  FAQ
1. How do I fix Database Seed errors?
Error: Unique constraint failed on the fields: (id) during npx prisma db seed.
Fix: This usually happens if you try to seed a database that already contains the initial data. You can either wipe your local database using npx prisma migrate reset (which will also run the seed automatically), or comment out the specific creation blocks in your seed.ts file that are causing the collision.
2. Why are my Clerk API Keys throwing 401 Unauthorized errors?
Error: Authentication fails, or the terminal shows Clerk: Secret key is missing or invalid.
Fix:
Log into your Clerk dashboard and double-check your NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.
Ensure you have not accidentally swapped the test mode keys with production keys.
Restart your Next.js development server, as changes to .env files require a hard restart.
3. How do I resolve Turbopack build issues?
Error: Next.js (Turbopack) fails to compile specific modules or hangs indefinitely.
Fix: Turbopack caching can sometimes become corrupted during aggressive hot-reloading or branch switching.
Delete the .next directory: rm -rf .next
Restart the development server.
If the issue persists, try running the standard Webpack bundler temporarily by removing the --turbo flag from your dev script in package.json.