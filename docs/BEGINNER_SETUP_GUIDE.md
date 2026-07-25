# WorkSphere Beginner Setup Guide

This guide is for new contributors who want to run WorkSphere locally for the first time. It focuses on the minimum setup needed for the Next.js app, Prisma, and the environment variables that power authentication and backend services.

## What you will set up

- Install project dependencies.
- Create a local `.env.local` file.
- Configure PostgreSQL, Clerk, and optional Upstash Redis.
- Generate Prisma client code.
- Start the local Next.js development server.

## Prerequisites

Before you begin, install the following:

- Node.js 18 or newer. Node.js 20 LTS is recommended if you are starting fresh.
- npm, which comes with Node.js.
- Git.
- A PostgreSQL database, local or hosted.

## 1. Clone the repository

```bash
git clone https://github.com/SatyamPandey-07/WorkSphere.git
cd WorkSphere
```

## 2. Install dependencies

Use the install command below so your local dependency tree matches the repository expectations:

```bash
npm install --legacy-peer-deps
```

If the install finishes successfully, Prisma's postinstall hook will also generate the client automatically. You can still run `npx prisma generate` manually in the next step to make sure everything is in sync.

## 3. Create your local environment file

Create a file named `.env.local` in the project root. Next.js reads this file automatically during local development.

At minimum, set the variables below:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/worksphere"
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_or_live_key"
CLERK_SECRET_KEY="sk_test_or_live_secret"
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
```

### Required variables

#### `DATABASE_URL`

The PostgreSQL connection string used by Prisma.

Example:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/worksphere"
```

If you are using a hosted provider such as Neon, Supabase, or Railway, paste the connection string from that provider instead. Those providers may still require `?sslmode=require` depending on their connection settings.

#### `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

The public Clerk key used by the browser client.

#### `CLERK_SECRET_KEY`

The private Clerk secret used by server-side routes.

#### `NEXT_PUBLIC_CLERK_SIGN_IN_URL`

The route used for the sign-in page.

#### `NEXT_PUBLIC_CLERK_SIGN_UP_URL`

The route used for the sign-up page.

### Optional variables

These are not required for the app to start, but they enable more features. Upstash Redis variables (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`) are strictly optional for local development. If omitted, Redis-backed features will fall back gracefully without blocking local app startup.

```env
UPSTASH_REDIS_REST_URL="https://your-upstash-endpoint"
UPSTASH_REDIS_REST_TOKEN="your-upstash-token"
CSRF_SECRET="a-long-random-secret"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

#### `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

Used for rate limiting, telemetry, event bus features, and other Redis-backed functionality.

If these are missing, the app can still run locally, but some background and analytics features may fall back to no-op behavior.

#### `CSRF_SECRET`

Optional secret used to sign CSRF tokens. In development, the app can fall back to `CLERK_SECRET_KEY`, but production should always define this explicitly.

#### `NEXT_PUBLIC_APP_URL`

Useful for local links and previews. Set it to `http://localhost:3000` during development.

## 4. Initialize Prisma

After setting `DATABASE_URL`, generate the Prisma client and prepare your database schema.

```bash
npx prisma generate
npx prisma db push
```

If you prefer migration files instead of pushing the schema directly, you can use:

```bash
npx prisma migrate dev --name init
```

For first-time local setup, `db push` is usually the fastest way to get the app running.

## 5. Start the Next.js development server

Run the local server with:

```bash
npm run dev
```

The app should be available at `http://localhost:3000` unless the port is already in use.

## 6. Optional: seed local data

If the project expects sample data in your database, run the seed command after Prisma is configured:

```bash
npx prisma db seed
```

## Troubleshooting

### Node.js version mismatch

If npm, Prisma, or Next.js complains about your Node version, check it first:

```bash
node -v
```

Recommended fixes:

- Switch to Node.js 20 LTS if possible.
- If you use `nvm`, run `nvm use 20` or `nvm install 20` first.
- Re-run `npm install --legacy-peer-deps` after changing Node versions.

### Port already in use

If `npm run dev` fails because port 3000 is busy, either stop the process using that port or start Next.js on a different port:

```bash
# macOS / Linux / Git Bash:
PORT=3001 npm run dev

# Windows (PowerShell):
$env:PORT=3001; npm run dev

# Windows (CMD):
set PORT=3001 && npm run dev
```

To find the process using port 3000 on Linux:

```bash
lsof -i :3000
```

### Prisma client not generated

If you see Prisma-related type or runtime errors, regenerate the client:

```bash
npx prisma generate
```

If the database schema changed, run `npx prisma db push` again before restarting the server.

### Missing environment variables

If the app shows authentication, database, or rate-limiting errors, verify that `.env.local` exists and includes the correct values for:

- `DATABASE_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Quick start checklist

1. Clone the repo.
2. Run `npm install --legacy-peer-deps`.
3. Create `.env.local`.
4. Set `DATABASE_URL`, Clerk keys, and any optional Redis values.
5. Run `npx prisma generate`.
6. Run `npx prisma db push` or `npx prisma migrate dev --name init`.
7. Start the app with `npm run dev`.

## Notes for new contributors

- Keep secrets out of Git. Never commit `.env.local`.
- If you are unsure which values to use for Clerk or Postgres, copy them from your service dashboards.
- When in doubt, start with the required variables only, get the app booting locally, and add optional integrations afterward.
