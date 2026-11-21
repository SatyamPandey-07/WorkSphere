-- Issue #7389: optimize spatial nearest-neighbor query using PostGIS ST_DWithin + GiST index

-- Step 1: Enable the PostGIS extension for geospatial types and functions
CREATE EXTENSION IF NOT EXISTS postgis;

-- Step 2: Add the geospatial coordinates column to Venue
ALTER TABLE "Venue" ADD COLUMN IF NOT EXISTS "coordinates" geography(Point, 4326);

-- Step 3: Backfill coordinates from existing latitude/longitude pairs
UPDATE "Venue"
SET "coordinates" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
WHERE "coordinates" IS NULL;

-- Step 4: Keep coordinates synchronized with latitude/longitude writes.
-- Prisma's client cannot write the Unsupported geography column directly, so
-- every INSERT/UPDATE of lat/lng must keep the spatial column in sync.
CREATE OR REPLACE FUNCTION sync_venue_coordinates() RETURNS trigger AS $$
BEGIN
  NEW."coordinates" := ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS venue_coordinates_sync ON "Venue";
CREATE TRIGGER venue_coordinates_sync
BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "Venue"
FOR EACH ROW EXECUTE FUNCTION sync_venue_coordinates();

-- Step 5: GiST index accelerating ST_DWithin filters and <-> KNN ordering
CREATE INDEX IF NOT EXISTS "venue_coordinates_gist" ON "Venue" USING GIST ("coordinates");
