# Database Seeding & Mock Data Guide

This guide explains how to initialize, clear, and seed the WorkSphere database with realistic mock data for local development, prototyping, and testing.

It covers:

- The purpose and structure of the database seed script
- How to add custom mock venues and rating data
- Core database commands for seeding and resetting
- Post-seeding verification checklist

---

## 1. Seed Script Overview

### Purpose of Database Seeding

WorkSphere uses an interactive map and search pipeline that relies on coordinates, categories, and ratings (e.g., WiFi quality, outlet density). When setting up the project for the first time, the database tables are empty.

Database seeding populates your database with high-quality mock data located in Brooklyn, NY. This allows you to immediately test the interactive map, road routing, search filters, AI chatbot, and review systems without manually creating data through the UI.

### Seed Script Structure

The database seeding logic is defined in [prisma/seed.js](prisma/seed.js). The script performs the following tasks:

1. **Environment Initialization**: Loads environment variables from `.env.local` using `dotenv`.
2. **Database Client Initialization**: Establishes a pooled PostgreSQL connection using `@prisma/adapter-pg` and the `pg` driver (complying with Prisma 7 driver adapters requirements).
3. **Test User Creation**: Creates or verifies a mock test user with Clerk ID `clerk_test_user_1` and email `nomad@worksphere.dev`. This user acts as the author for the initial rating entries.
4. **Mock Venues Loop**: Iterates over a predefined array of mock venues (`mockVenues`) and inserts or updates them using Prisma `upsert` queries to prevent duplicates.
5. **Mock Ratings Loop**: Generates a detailed mock review (`VenueRating`) for each venue, authored by the mock test user, including wifi metrics, noise scores, outlet availability, and a placeholder review text.
6. **Graceful Disconnect**: Disconnects the Prisma client when seeding completes or if an error is encountered.

### When to Run the Seed Script

You should execute the seed script during:

- **First-time setup**: After creating your database and pushing the schema.
- **Database resets**: After dropping tables or updating schema fields to restore test data.
- **Testing iterations**: When verifying search queries, filters, or AI responses against a known set of locations.

---

## 2. Custom Venue Creation

If you need to test specific scenarios (e.g., low-WiFi cafes, loud coworking spaces, libraries with no outlets), you can add custom entries to the `mockVenues` array in [prisma/seed.js](prisma/seed.js).

### Configurable Fields

Each venue object in the `mockVenues` array supports the following properties:

| Field           |   Type    | Description                                          | Allowed Values / Examples                            |
| :-------------- | :-------: | :--------------------------------------------------- | :--------------------------------------------------- |
| `placeId`       | `String`  | **Required**. A unique identifier for the venue.     | `osm-venue-6`, `my-custom-cafe`                      |
| `name`          | `String`  | **Required**. Display name of the workspace.         | `"Brooklyn Standard Cafe"`, `"Greenpoint Quiet Hub"` |
| `latitude`      |  `Float`  | **Required**. Latitude coordinate for map plotting.  | `40.7182`                                            |
| `longitude`     |  `Float`  | **Required**. Longitude coordinate for map plotting. | `-73.9563`                                           |
| `category`      | `String`  | **Required**. Type of workspace.                     | `cafe`, `coworking`, `library`                       |
| `address`       | `String`  | Full physical address.                               | `"188 Nassau Ave, Brooklyn, NY 11222"`               |
| `wifiQuality`   |   `Int`   | Integer rating of WiFi quality (1 to 5).             | `1`, `2`, `3`, `4`, `5`                              |
| `hasOutlets`    | `Boolean` | Flag indicating if power outlets are available.      | `true`, `false`                                      |
| `noiseLevel`    | `String`  | Ambient noise level categorization.                  | `quiet`, `moderate`, `loud`                          |
| `hasErgonomic`  | `Boolean` | Flag indicating if ergonomic seating is present.     | `true`, `false`                                      |
| `outletDensity` | `String`  | Qualitative distribution of outlets.                 | `every_table`, `some_tables`, `wall_seats`, `none`   |
| `wifiSpeed`     |   `Int`   | Average internet download speed in Mbps.             | `85`, `180`, `250`                                   |
| `crowdsourced`  | `Boolean` | Identifies if the venue was submitted by a user.     | `true`, `false`                                      |

### Step-by-Step: Adding a New Venue

To add a custom venue:

1. Open [prisma/seed.js](prisma/seed.js).
2. Locate the `mockVenues` array at the top of the file.
3. Append your new mock venue object:

```javascript
{
  placeId: "osm-venue-6",
  name: "Prospect Park Study Cafe",
  latitude: 40.6628,
  longitude: -73.9695,
  category: "cafe",
  address: "95 Prospect Park West, Brooklyn, NY 11215",
  wifiQuality: 5,
  hasOutlets: true,
  noiseLevel: "quiet",
  hasErgonomic: true,
  outletDensity: "every_table",
  wifiSpeed: 300,
  crowdsourced: true,
}
```

4. Run the seed execution command to write the new record to PostgreSQL.

---

## 3. Database Execution

Run these commands in your terminal from the project root directory.

### Running the Seed Script

To seed your database with the mock data without dropping any existing tables or schemas:

```bash
npx prisma db seed
```

**What it does**: Reads [prisma/seed.js](prisma/seed.js) and executes the `main()` function to upsert the mock user, mock venues, and mock ratings into PostgreSQL.

### Resetting the Database

To clean your database, rebuild the tables from migrations, and reseed the data:

```bash
npx prisma migrate reset
```

**What it does**: Drops all tables in the database, recreates the schema by executing all files in `prisma/migrations/`, and automatically calls the seed script configured under `"prisma": { "seed": "node prisma/seed.js" }` in `package.json`.

> [!WARNING]
> This command will permanently delete all data in your database. Use this command with caution in non-development environments.

### Clearing and Reseeding (Alternative)

If you are developing locally without full migrations tracking (e.g., using prototyping commands) and want to force-reset data:

```bash
npx prisma db push --force-reset
npx prisma db seed
```

**What it does**: `--force-reset` wipes your database clean, re-creates the database structure according to the current [prisma/schema.prisma](prisma/schema.prisma) file, and the second command applies the seed records.

---

## 4. Verification Checklist

After running the database seed commands, execute the following steps to confirm everything succeeded:

### 1. Verify Command Output

Ensure your terminal output reports a clean run with no errors:

```text
Starting database seed...
Mock user created/verified: nomad@worksphere.dev
Venue seeded: Brooklyn Standard Cafe
Rating seeded for venue: Brooklyn Standard Cafe
...
Database seeding completed successfully!
```

### 2. Verify Records in PostgreSQL

Launch Prisma Studio to visually inspect your tables:

```bash
npx prisma studio
```

This opens a local browser interface at `http://localhost:5555`. Open the tables and verify the following counts:

- **User**: At least 1 row (email: `nomad@worksphere.dev`).
- **Venue**: At least 5 rows matching the seeded mock venues.
- **VenueRating**: At least 5 ratings linked to the mock venues and user.

### 3. Verify Venues Appear in the Application

1. Start the Next.js development server:
   ```bash
   npm run dev
   ```
2. Open `http://localhost:3000` in your web browser.
3. Search for a venue or type a natural language query in the chat (e.g., "cafes in Brooklyn").
4. Verify that the glowing purple venue markers load on the map and the interactive list is populated with names like "Brooklyn Standard Cafe" and "Dumbo WorkSpace Collective".
   > [!NOTE]
   > If the map appears blank, ensure your user location is set or mocked to Brooklyn (latitude: `40.71`, longitude: `-73.95`) so that the bounding box search captures the seeded coordinates.

### 4. Verify Repository Integrity

Verify that no configuration files, tests, or application source files were altered during documentation:

```bash
git status
```

Confirm that the only modified/untracked file is `docs/DATABASE_SEEDING.md`.
