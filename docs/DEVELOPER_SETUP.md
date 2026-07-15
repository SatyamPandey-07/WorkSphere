# WorkSphere Local Development Setup, Migrations & Seeding Guide

This guide walks you through setting up your local database, running Prisma migrations, and seeding mock workspace coordinates for the WorkSphere interactive map.

---

## 1. Database Configuration

WorkSphere uses PostgreSQL with the `pgvector` extension to store venue parameters, user accounts, and semantic AI memories.

### Option A: Local PostgreSQL Setup
1. **Install PostgreSQL** (v15+) on your system (e.g. via Homebrew on Mac, or the official installer on Windows).
2. Ensure you have the `pgvector` extension compiled/installed.
3. Create a local database named `worksphere`.
4. Create a `.env.local` file in the project root and define your connection string:
   ```env
   DATABASE_URL="postgresql://<username>:<password>@localhost:5432/worksphere"
   ```

### Option B: Cloud Database (Neon.tech - Recommended)
1. Sign up at [Neon.tech](https://neon.tech/) and create a new PostgreSQL project.
2. Select your project dashboard, copy the connection string, and paste it into `.env.local`:
   ```env
   DATABASE_URL="postgresql://<user>:<password>@<ep-name>.us-east-2.aws.neon.tech/neondb?sslmode=require"
   ```

---

## 2. Prisma Database Schema & Migrations

Once your `DATABASE_URL` is configured, follow these steps to initialize your database structure:

### Step 1: Install Dependencies
Run package installation to ensure all client libraries are in place:
```bash
npm install
```

### Step 2: Generate Prisma Client
Build the type bindings for your schema locally:
```bash
npx prisma generate
```

### Step 3: Push Database Schema
To update your database structure with the models defined in [schema.prisma](file:///C:/Users/Rajasekar/.gemini/antigravity/scratch/WorkSphere/prisma/schema.prisma) without full migrations history (useful for local development/prototyping):
```bash
npx prisma db push
```

For production-like environments where migration history is tracked:
```bash
npx prisma migrate dev --name init
```

---

## 3. Populating Local Mock Workspaces (Seeding)

To explore and test maps, routes, and reviews locally, populate your database with high-quality mock venues located in Brooklyn/New York.

### Running the Seed Script
Execute the native Prisma seed command:
```bash
npx prisma db seed
```

This runs the seed script [seed.js](file:///C:/Users/Rajasekar/.gemini/antigravity/scratch/WorkSphere/prisma/seed.js) which automatically inserts:
* **Mock User**: A test account (`clerk_test_user_1` / `nomad@worksphere.dev`) for rating ownership.
* **Mock Workspaces**: 5 venues containing complete coordinates, Categories (cafe, coworking, library), WiFi quality ratings, outlet density, and verified download speeds.
* **Mock Reviews**: Rich comments and verified parameters associated with each workspace.

---

## 4. Troubleshooting Map Exploration

* **Empty Map / Empty Results**: If the map displays a blank slate or chat searches fail to yield results, verify that:
  1. The database holds seeded coordinates (run `npx prisma studio` to inspect the `Venue` table).
  2. Your user location matches the seeded Brooklyn area (lat: `40.71`, lng: `-73.95`). You can mock this coordinate in browser devtools Geolocation emulation.
* **Prisma Mismatch Errors**: If you modify the Prisma schema, always run:
  ```bash
  npx prisma generate
  ```
  before launching the Next.js development server.
