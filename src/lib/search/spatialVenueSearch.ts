import { prisma } from "@/lib/prisma";

export interface SpatialVenueResult {
  id: string;
  name: string;
  category: string;
  address: string | null;
  rating: number | null;
  imageUrl: string | null;
  latitude: number;
  longitude: number;
  distanceMeters: number;
}

export const DEFAULT_SEARCH_RADIUS_METERS = 5000;
export const MAX_SEARCH_RADIUS_METERS = 100000;
export const MAX_SPATIAL_RESULT_LIMIT = 50;

/**
 * Finds venues within `radiusMeters` of (lat, lng) using PostGIS.
 *
 * The query is executed entirely inside PostgreSQL:
 * - `ST_DWithin` (geography) is index-accelerated by the GiST index on
 *   `Venue.coordinates`, so the planner performs an index scan instead of a
 *   full table scan.
 * - `ORDER BY coordinates <-> center` uses the KNN distance operator so the
 *   GiST index also serves the ordering.
 * - The distance in meters is returned directly from the SQL projection via
 *   `ST_Distance`, so no haversine math is done in Node.js.
 */
export async function searchVenuesNearby(
  lat: number,
  lng: number,
  radiusMeters: number = DEFAULT_SEARCH_RADIUS_METERS,
  limit: number = 20
): Promise<SpatialVenueResult[]> {
  return prisma.$queryRaw<SpatialVenueResult[]>`
    SELECT
      "id",
      "name",
      "category",
      "address",
      "rating",
      "imageUrl",
      "latitude",
      "longitude",
      ST_Distance(
        "coordinates",
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      )::double precision AS "distanceMeters"
    FROM "Venue"
    WHERE ST_DWithin(
      "coordinates",
      ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
      ${radiusMeters}
    )
    ORDER BY "coordinates" <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
    LIMIT ${limit};
  `;
}
