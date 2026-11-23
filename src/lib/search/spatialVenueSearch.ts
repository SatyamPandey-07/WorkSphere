import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Strict WGS84 coordinate schema enforcing:
 * - latitude  ∈ [-90, 90]
 * - longitude ∈ [-180, 180]
 */
export const GeoCoordinateSchema = z.object({
  latitude: z
    .number({ invalid_type_error: "Latitude must be a finite number" })
    .finite()
    .min(-90, "Latitude must be >= -90 degrees")
    .max(90, "Latitude must be <= 90 degrees"),
  longitude: z
    .number({ invalid_type_error: "Longitude must be a finite number" })
    .finite()
    .min(-180, "Longitude must be >= -180 degrees")
    .max(180, "Longitude must be <= 180 degrees"),
});

export const SpatialVenueSearchInputSchema = GeoCoordinateSchema.extend({
  radiusMeters: z
    .number()
    .finite()
    .positive("Radius must be greater than 0 meters")
    .max(50_000, "Radius cannot exceed 50,000 meters")
    .default(5_000),
  limit: z.number().int().min(1).max(100).default(25),
  maxNoiseDb: z.number().min(20).max(120).optional(),
  minWifiMbps: z.number().min(0).optional(),
});

export type GeoCoordinate = z.infer<typeof GeoCoordinateSchema>;
export type SpatialVenueSearchInput = z.input<
  typeof SpatialVenueSearchInputSchema
>;

export interface SpatialVenueSearchRow {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  wifiSpeedMbps: number | null;
  noiseDb: number | null;
  outletDensity: number | null;
  rating: number | null;
  distanceMeters: number;
}

/**
 * Validates WGS84 latitude/longitude bounds and returns a canonical [longitude, latitude]
 * PostGIS X/Y tuple so callers never invert axes into ST_MakePoint(lon, lat).
 */
export function toPostGisLonLatTuple(coord: GeoCoordinate): [number, number] {
  const validated = GeoCoordinateSchema.parse(coord);
  // PostGIS X = longitude, Y = latitude
  return [validated.longitude, validated.latitude];
}

/**
 * Builds the parameterized Prisma.Sql fragment for a WGS84 PostGIS point:
 * ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
 */
export function buildPostGisGeographyPoint(coord: GeoCoordinate): Prisma.Sql {
  const [longitude, latitude] = toPostGisLonLatTuple(coord);
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;
}

/**
 * Computes spherical surface distance in meters between two WGS84 coordinates (Haversine).
 * Used for in-memory verification and fallback distance scoring.
 */
export function calculateSphericalDistanceMeters(
  origin: GeoCoordinate,
  target: GeoCoordinate,
): number {
  const a = GeoCoordinateSchema.parse(origin);
  const b = GeoCoordinateSchema.parse(target);

  const EARTH_RADIUS_M = 6_371_008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);

  const h =
    sinHalfLat * sinHalfLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Queries nearby nomad venues using PostGIS ST_DWithin and KNN spherical distance ordering,
 * enforcing strict (longitude, latitude) parameter ordering in ST_MakePoint($1, $2).
 */
export async function searchVenuesWithinRadius(
  rawInput: SpatialVenueSearchInput,
): Promise<SpatialVenueSearchRow[]> {
  const input = SpatialVenueSearchInputSchema.parse(rawInput);
  const [longitude, latitude] = toPostGisLonLatTuple({
    latitude: input.latitude,
    longitude: input.longitude,
  });

  const noiseFilter =
    typeof input.maxNoiseDb === "number"
      ? Prisma.sql`AND (v."noiseDb" IS NULL OR v."noiseDb" <= ${input.maxNoiseDb})`
      : Prisma.empty;

  const wifiFilter =
    typeof input.minWifiMbps === "number"
      ? Prisma.sql`AND (v."wifiSpeedMbps" IS NOT NULL AND v."wifiSpeedMbps" >= ${input.minWifiMbps})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<SpatialVenueSearchRow[]>(Prisma.sql`
    SELECT
      v."id",
      v."name",
      v."address",
      v."latitude",
      v."longitude",
      v."wifiSpeedMbps",
      v."noiseDb",
      v."outletDensity",
      v."rating",
      ST_Distance(
        ST_SetSRID(ST_MakePoint(v."longitude", v."latitude"), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
      ) AS "distanceMeters"
    FROM "Venue" v
    WHERE ST_DWithin(
      ST_SetSRID(ST_MakePoint(v."longitude", v."latitude"), 4326)::geography,
      ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
      ${input.radiusMeters}
    )
    ${noiseFilter}
    ${wifiFilter}
    ORDER BY
      ST_SetSRID(ST_MakePoint(v."longitude", v."latitude"), 4326)::geography <->
      ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography ASC
    LIMIT ${input.limit}
  `);

  return rows.map((row) => ({
    ...row,
    distanceMeters: Number(row.distanceMeters),
  }));
}

export const DEFAULT_SEARCH_RADIUS_METERS = 5000;
export const MAX_SEARCH_RADIUS_METERS = 50000;
export const MAX_SPATIAL_RESULT_LIMIT = 100;
export const searchVenuesNearby = searchVenuesWithinRadius;
