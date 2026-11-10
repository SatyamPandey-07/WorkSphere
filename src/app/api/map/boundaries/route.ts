import { NextRequest, NextResponse } from "next/server";
import {
  withGeoJsonCache,
  STATIC_GEOJSON_CACHE_CONTROL,
  GEOJSON_CONTENT_TYPE,
  generateETag,
  isETagMatch,
  create304Response,
} from "@/lib/http/etag";

export interface GeoJsonPolygonGeometry {
  type: "Polygon";
  coordinates: number[][][]; // [linearRing[position[lng, lat]]]
}

export interface DistrictBoundaryFeature {
  type: "Feature";
  id: string;
  properties: {
    id: string;
    name: string;
    district: string;
    city: string;
    state?: string;
    country: string;
    category: "business_district" | "tech_corridor" | "creative_hub" | "academic_zone";
    description: string;
    activeVenuesCount: number;
    quietScore: number;
    averageWifiSpeed: number;
    lastUpdated: string;
  };
  geometry: GeoJsonPolygonGeometry;
}

export interface DistrictBoundariesCollection {
  type: "FeatureCollection";
  metadata: {
    generator: "WorkSphere Spatial Engine";
    version: "1.0.0";
    crs: "EPSG:4326";
    generatedAt: string;
    featureCount: number;
  };
  features: DistrictBoundaryFeature[];
}

/**
 * Static RFC 7946 GeoJSON boundary definitions for key nomad workspace districts.
 * All coordinate linear rings strictly follow [longitude, latitude] axis ordering and
 * closure rules (start vertex equals end vertex).
 */
export const STATIC_DISTRICT_BOUNDARIES: DistrictBoundaryFeature[] = [
  {
    type: "Feature",
    id: "boundary-sf-financial-district",
    properties: {
      id: "sf-financial-district",
      name: "Financial District",
      district: "financial-district",
      city: "San Francisco",
      state: "CA",
      country: "USA",
      category: "business_district",
      description: "Primary commercial corridor with high-density gigabit fiber hubs and executive lounges.",
      activeVenuesCount: 42,
      quietScore: 0.78,
      averageWifiSpeed: 245,
      lastUpdated: "2026-11-01T00:00:00.000Z",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-122.404, 37.791],
          [-122.398, 37.795],
          [-122.393, 37.793],
          [-122.399, 37.788],
          [-122.404, 37.791],
        ],
      ],
    },
  },
  {
    type: "Feature",
    id: "boundary-sf-soma-corridor",
    properties: {
      id: "sf-soma-corridor",
      name: "SOMA Innovation Corridor",
      district: "soma",
      city: "San Francisco",
      state: "CA",
      country: "USA",
      category: "tech_corridor",
      description: "High-concentration startup district featuring ergonomic tech lofts and standing-desk cafes.",
      activeVenuesCount: 56,
      quietScore: 0.65,
      averageWifiSpeed: 310,
      lastUpdated: "2026-11-01T00:00:00.000Z",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-122.415, 37.782],
          [-122.397, 37.788],
          [-122.391, 37.778],
          [-122.409, 37.772],
          [-122.415, 37.782],
        ],
      ],
    },
  },
  {
    type: "Feature",
    id: "boundary-bk-dumbo-tech-triangle",
    properties: {
      id: "bk-dumbo-tech-triangle",
      name: "DUMBO Tech Triangle",
      district: "dumbo",
      city: "Brooklyn",
      state: "NY",
      country: "USA",
      category: "creative_hub",
      description: "Waterfront creative workspace zone with hybrid nomad collectives and acoustic quiet pods.",
      activeVenuesCount: 28,
      quietScore: 0.82,
      averageWifiSpeed: 220,
      lastUpdated: "2026-11-01T00:00:00.000Z",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-73.995, 40.704],
          [-73.986, 40.706],
          [-73.982, 40.701],
          [-73.991, 40.699],
          [-73.995, 40.704],
        ],
      ],
    },
  },
  {
    type: "Feature",
    id: "boundary-bk-williamsburg-corridor",
    properties: {
      id: "bk-williamsburg-corridor",
      name: "Williamsburg Creative Corridor",
      district: "williamsburg",
      city: "Brooklyn",
      state: "NY",
      country: "USA",
      category: "creative_hub",
      description: "Artisan coffee roasters and shared work lounges with quiet courtyards.",
      activeVenuesCount: 34,
      quietScore: 0.71,
      averageWifiSpeed: 175,
      lastUpdated: "2026-11-01T00:00:00.000Z",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-73.965, 40.718],
          [-73.955, 40.721],
          [-73.951, 40.712],
          [-73.961, 40.709],
          [-73.965, 40.718],
        ],
      ],
    },
  },
];

/**
 * Builds the GeoJSON FeatureCollection response payload, optionally filtered
 * by district or city query parameters.
 */
export function getDistrictBoundariesPayload(
  district?: string | null,
  city?: string | null,
): DistrictBoundariesCollection {
  let features = STATIC_DISTRICT_BOUNDARIES;

  if (district) {
    const normalizedDistrict = district.trim().toLowerCase();
    features = features.filter(
      (f) =>
        f.properties.district.toLowerCase() === normalizedDistrict ||
        f.properties.name.toLowerCase().includes(normalizedDistrict),
    );
  }

  if (city) {
    const normalizedCity = city.trim().toLowerCase();
    features = features.filter(
      (f) => f.properties.city.toLowerCase() === normalizedCity,
    );
  }

  return {
    type: "FeatureCollection",
    metadata: {
      generator: "WorkSphere Spatial Engine",
      version: "1.0.0",
      crs: "EPSG:4326",
      generatedAt: "2026-11-01T00:00:00.000Z",
      featureCount: features.length,
    },
    features,
  };
}

/**
 * GET /api/map/boundaries
 *
 * Serves static geoJSON district boundary assets with:
 * - Cache-Control: public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400
 * - Strong SHA-256 ETag calculated based on body content
 * - Instant 304 Not Modified response on matching client If-None-Match
 */
export const GET = withGeoJsonCache(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const district = searchParams.get("district");
  const city = searchParams.get("city");

  const payload = getDistrictBoundariesPayload(district, city);

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Content-Type": GEOJSON_CONTENT_TYPE,
    },
  });
});

/**
 * HEAD /api/map/boundaries
 *
 * Supports lightweight cache validation and ETag verification without payload download.
 */
export const HEAD = withGeoJsonCache(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const district = searchParams.get("district");
  const city = searchParams.get("city");

  const payload = getDistrictBoundariesPayload(district, city);

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Content-Type": GEOJSON_CONTENT_TYPE,
    },
  });
});
