# Prisma Custom Seed Parameters Guide

This document explains how to run, customize, and extend `prisma/seed.js` — the script that populates your local database with mock venues, a test user, and sample ratings so you have real data to develop against.

## 1. What the Seed Script Does

Running the seed script performs three things, in order:

1. **Upserts a mock test user** (`clerk_test_user_1`) — used as the author of all seeded venue ratings.
2. **Upserts 5 mock venues** into the `Venue` table, each with a fixed `latitude`/`longitude`, category, and amenity data (wifi quality, outlets, noise level, etc.).
3. **Upserts a `VenueRating`** for each venue, authored by the mock test user.

The default dataset is centered on **Brooklyn, NY** (roughly 40.67–40.73°N, -73.95 to -73.99°W).

## 2. Prerequisites

| Requirement                              | Why                                                                                                                                               |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| A working `DATABASE_URL` in `.env.local` | The seed script connects via Prisma's configured adapter — see `docs/ENVIRONMENT_VARIABLES.md` §2.A for how to get a free Neon connection string. |
| Migrations applied                       | Run `npx prisma migrate dev` first if you haven't already — the seed script will fail if the tables it writes to don't exist yet.                 |

## 3. Running the Seed Script

```bash
npx prisma db seed
```

This runs `node prisma/seed.js` (configured via the `seed` field in `prisma.config.ts` and `package.json`). On success, you'll see one line per venue and rating:

```
Starting database seed...
Mock user created/verified: nomad@worksphere.dev
Venue seeded: Brooklyn Standard Cafe
Rating seeded for venue: Brooklyn Standard Cafe
...
Database seeding completed successfully!
```

The script uses `upsert` throughout, so it's safe to re-run — it won't create duplicate rows, it'll just update the existing ones.

## 4. Customizing Coordinates for Your Location

If you're developing a location-based feature (map views, distance filters, heatmaps) and want test data near a specific city instead of Brooklyn, edit the `mockVenues` array at the top of `prisma/seed.js`:

```js
const mockVenues = [
  {
    placeId: "osm-venue-1",
    name: "Your Venue Name",
    latitude: 40.7182, // <-- change this
    longitude: -73.9563, // <-- change this
    category: "cafe",
    address: "Your address here",
    wifiQuality: 4,
    hasOutlets: true,
    noiseLevel: "moderate",
    hasErgonomic: false,
    outletDensity: "some_tables",
    wifiSpeed: 85,
    crowdsourced: true,
  },
  // ...repeat for as many venues as you want
];
```

**Finding coordinates:** the fastest way is [OpenStreetMap's Nominatim search](https://nominatim.openstreetmap.org/) or just right-clicking a location on Google Maps and copying the lat/lng shown.

**Field reference:**

| Field                    | Type     | Notes                                                             |
| :----------------------- | :------- | :---------------------------------------------------------------- |
| `placeId`                | `string` | Must be unique — this is the `upsert` key for the `Venue` table.  |
| `latitude` / `longitude` | `number` | Standard decimal degrees.                                         |
| `category`               | `string` | e.g. `"cafe"`, `"coworking"`, `"library"`.                        |
| `noiseLevel`             | `string` | `"quiet"` \| `"moderate"` \| `"loud"` — categorical label.        |
| `outletDensity`          | `string` | `"every_table"` \| `"some_tables"` \| `"wall_seats"` \| `"none"`. |

## 5. Adding New Fields to Seeded Ratings — a Gotcha to Know About

If you add a new property to an object in `mockVenues` (for example, `avgDecibels` for a numeric noise rating), **adding it to the object alone is not enough.** The `prisma.venueRating.upsert()` call further down the file has two separate blocks — `update:` and `create:` — and Prisma only writes fields that are explicitly listed in whichever block actually runs:

```js
await prisma.venueRating.upsert({
  where: { userId_venueId: { userId: testUser.id, venueId: venue.id } },
  update: {
    // ...existing fields...
    avgDecibels: vData.avgDecibels, // must be added here too
  },
  create: {
    // ...existing fields...
    avgDecibels: vData.avgDecibels, // AND here
  },
});
```

It's easy to add the field to `mockVenues`, add it to one of the two blocks, and forget the other — the seed script will still run without errors, but the field will silently stay `null` in the database. If a query later filters on that field (e.g. `where: { avgDecibels: { not: null } }`), it'll come back empty even though the seed "succeeded."

**To verify a field actually persisted**, check it directly in Neon's SQL Editor:

```sql
SELECT id, "venueId", "avgDecibels" FROM "VenueRating";
```

If you added a field to only one block, re-running `npx prisma db seed` after fixing both blocks will backfill existing rows correctly (since `upsert` runs the `update` path once the rows already exist).

## 6. Quick Reference

| Command                                    | Purpose                                    |
| :----------------------------------------- | :----------------------------------------- |
| `npx prisma migrate dev`                   | Apply/sync database schema before seeding. |
| `npx prisma db seed`                       | Run the seed script.                       |
| `SELECT * FROM "Venue";` (Neon SQL Editor) | Inspect seeded venues directly.            |
