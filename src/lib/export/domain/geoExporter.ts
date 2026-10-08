/**
 * Geographic Exporter (GeoJSON and KML).
 *
 * Implements RFC 7946 GeoJSON and OGC KML 2.2 export formats
 * for saved venues, collections, and favorites.
 * Supports polygon boundary validation, self-intersection checking,
 * and geometry repair.
 */

import { appUrl } from "@/lib/appUrl";
import { escapeHtml } from "@/lib/html";
import {
  isPolygonRingClosed,
  ensurePolygonRingClosed,
  doSegmentsIntersect,
  findPolygonSelfIntersections,
  hasPolygonSelfIntersection,
  validatePolygonRing,
  computeConvexHull,
  createBoundingBoxPolygon,
  repairSelfIntersectingPolygon,
  ensureCounterClockwise,
  type PolygonValidationResult,
  type IntersectionDetail,
} from "@/lib/geometry/polygonValidation";

export {
  isPolygonRingClosed,
  ensurePolygonRingClosed,
  doSegmentsIntersect,
  findPolygonSelfIntersections,
  hasPolygonSelfIntersection,
  validatePolygonRing,
  computeConvexHull,
  createBoundingBoxPolygon,
  repairSelfIntersectingPolygon,
  ensureCounterClockwise,
  type PolygonValidationResult,
  type IntersectionDetail,
};

export const GEO_EXPORT_FORMATS = ["geojson", "kml"] as const;
export type GeoExportFormat = (typeof GEO_EXPORT_FORMATS)[number];

export const GEOJSON_CONTENT_TYPE = "application/geo+json";
export const KML_CONTENT_TYPE = "application/vnd.google-earth.kml+xml";
export const KML_NAMESPACE = "http://www.opengis.net/kml/2.2";

export const AMENITY_FLAGS = [
  ["hasOutlets", "Power outlets"],
  ["hasErgonomic", "Ergonomic seating"],
  ["hasPhoneBooths", "Phone booths"],
  ["hasQuietZone", "Quiet zone"],
  ["hasNoMusic", "No music"],
  ["hasAncHeadsetRental", "ANC headset rental"],
  ["singleOriginBeans", "Single-origin beans"],
  ["specialtyEspresso", "Specialty espresso"],
  ["oatAlmondMilk", "Oat/almond milk"],
  ["pourOverAvailable", "Pour-over coffee"],
  ["petsAllowedIndoors", "Pets allowed indoors"],
  ["dogFriendly", "Dog friendly"],
  ["catsAllowed", "Cats allowed"],
  ["waterBowlsProvided", "Water bowls provided"],
] as const;

export type AmenityFlag = (typeof AMENITY_FLAGS)[number][0];

export const GEO_EXPORT_VENUE_SELECT = {
  id: true,
  name: true,
  latitude: true,
  longitude: true,
  address: true,
  category: true,
  wifiQuality: true,
  wifiSpeed: true,
  hasOutlets: true,
  hasErgonomic: true,
  hasPhoneBooths: true,
  hasQuietZone: true,
  hasNoMusic: true,
  hasAncHeadsetRental: true,
  singleOriginBeans: true,
  specialtyEspresso: true,
  oatAlmondMilk: true,
  pourOverAvailable: true,
  petsAllowedIndoors: true,
  dogFriendly: true,
  catsAllowed: true,
  waterBowlsProvided: true,
} as const;

export type GeoExportVenue = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  category: string;
  wifiQuality?: number | null;
  wifiSpeed?: number | null;
  hasOutlets?: boolean | null;
  hasErgonomic?: boolean | null;
  hasPhoneBooths?: boolean | null;
  hasQuietZone?: boolean | null;
  hasNoMusic?: boolean | null;
  hasAncHeadsetRental?: boolean | null;
  singleOriginBeans?: boolean | null;
  specialtyEspresso?: boolean | null;
  oatAlmondMilk?: boolean | null;
  pourOverAvailable?: boolean | null;
  petsAllowedIndoors?: boolean | null;
  dogFriendly?: boolean | null;
  catsAllowed?: boolean | null;
  waterBowlsProvided?: boolean | null;
};

export type GeoExportFolder = {
  id?: string;
  name: string;
  description?: string | null;
  userId?: string;
  items?: Array<{
    venue: GeoExportVenue;
  }>;
};

export function hasValidCoordinates(venue: {
  latitude: unknown;
  longitude: unknown;
}): boolean {
  if (
    typeof venue.latitude !== "number" ||
    typeof venue.longitude !== "number" ||
    !Number.isFinite(venue.latitude) ||
    !Number.isFinite(venue.longitude)
  ) {
    return false;
  }
  // (0, 0) is rejected because WorkSphere uses it as a placeholder for unknown coordinates
  if (venue.latitude === 0 && venue.longitude === 0) {
    return false;
  }
  return (
    venue.latitude >= -90 &&
    venue.latitude <= 90 &&
    venue.longitude >= -180 &&
    venue.longitude <= 180
  );
}

export function normalizeVenueAmenities(venue: GeoExportVenue): string[] {
  const amenities: string[] = [];
  if ((venue.wifiSpeed ?? 0) > 0 || (venue.wifiQuality ?? 0) > 0) {
    amenities.push("Wi-Fi");
  }
  for (const [flag, label] of AMENITY_FLAGS) {
    if (venue[flag] === true) {
      amenities.push(label);
    }
  }
  return amenities;
}

export function extractAmenities(venue: GeoExportVenue): string[] {
  return normalizeVenueAmenities(venue);
}

export function getVenueWorkSphereUrl(venueId: string): string {
  return appUrl(`/venues/${encodeURIComponent(venueId)}`);
}

export function venueProperties(venue: GeoExportVenue) {
  return {
    name: venue.name,
    address: venue.address ?? null,
    category: venue.category,
    amenities: normalizeVenueAmenities(venue),
    workSphereUrl: getVenueWorkSphereUrl(venue.id),
  };
}

export type GeoJsonPointFeature = {
  type: "Feature";
  id: string;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: ReturnType<typeof venueProperties>;
};

export type GeoJsonPolygonFeature = {
  type: "Feature";
  id?: string;
  geometry: {
    type: "Polygon";
    coordinates: number[][][]; // [exteriorRing, ...holes]
  };
  properties: Record<string, unknown>;
};

export type GeoJsonFeature = GeoJsonPointFeature | GeoJsonPolygonFeature;

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  metadata?: {
    folderId?: string;
    folderName?: string;
    description?: string | null;
    exportedAt?: string;
    featureCount?: number;
    generator?: string;
  };
  features: GeoJsonFeature[];
};

/**
 * Generates an RFC 7946 GeoJSON spatial bounding polygon feature for a venue collection.
 * Automatically validates coordinates against self-intersection, closedness,
 * and repairs or buffers invalid geometries.
 */
export function generateFolderBoundingPolygon(
  venuesOrCoordinates: (GeoExportVenue | number[])[],
  options: {
    folderName?: string;
    bufferPadding?: number;
    repairInvalid?: boolean;
  } = {},
): GeoJsonPolygonFeature | null {
  const coordinates: number[][] = [];
  for (const item of venuesOrCoordinates) {
    if (Array.isArray(item) && item.length >= 2) {
      if (Number.isFinite(item[0]) && Number.isFinite(item[1])) {
        coordinates.push([item[0], item[1]]);
      }
    } else if (typeof item === "object" && item !== null && "latitude" in item) {
      const v = item as GeoExportVenue;
      if (hasValidCoordinates(v)) {
        coordinates.push([v.longitude, v.latitude]);
      }
    }
  }

  if (coordinates.length < 3) {
    return null;
  }

  // If a full polygon ring was provided, validate and repair self-intersection
  let ring: number[][];
  if (
    coordinates.length >= 4 &&
    Math.abs(coordinates[0][0] - coordinates[coordinates.length - 1][0]) < 1e-9 &&
    Math.abs(coordinates[0][1] - coordinates[coordinates.length - 1][1]) < 1e-9
  ) {
    ring = repairSelfIntersectingPolygon(coordinates, {
      bufferPadding: options.bufferPadding,
    });
  } else {
    // Generate convex hull bounding polygon around venue point positions
    const hull = computeConvexHull(coordinates);
    if (hull.length >= 4 && !hasPolygonSelfIntersection(hull)) {
      ring = hull;
    } else {
      ring = createBoundingBoxPolygon(coordinates, options.bufferPadding ?? 0.001);
    }
  }

  const validation = validatePolygonRing(ring);
  if (!validation.isValid && options.repairInvalid !== false) {
    ring = repairSelfIntersectingPolygon(ring, {
      bufferPadding: options.bufferPadding,
    });
  }

  return {
    type: "Feature",
    id: options.folderName ? `boundary-${options.folderName}` : "boundary",
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
    properties: {
      type: "BoundingPolygon",
      name: options.folderName ? `${options.folderName} Boundary` : "Spatial Boundary",
      vertexCount: ring.length,
      isValidGeoJson: true,
    },
  };
}

export function venuesToGeoJson(
  input: GeoExportFolder | GeoExportVenue[],
  exportedAt?: Date,
  options: { includeBoundary?: boolean; boundaryRing?: number[][] } = {},
): GeoJsonFeatureCollection {
  const isFolder = !Array.isArray(input) && typeof input === "object" && input !== null;
  const venues: GeoExportVenue[] = isFolder
    ? (input.items ? input.items.map((item) => item.venue) : [])
    : (input as GeoExportVenue[]);

  const pointFeatures: GeoJsonPointFeature[] = venues
    .filter(hasValidCoordinates)
    .map((venue) => ({
      type: "Feature" as const,
      id: venue.id,
      geometry: {
        type: "Point" as const,
        coordinates: [venue.longitude, venue.latitude] as [number, number],
      },
      properties: venueProperties(venue),
    }));

  const features: GeoJsonFeature[] = [...pointFeatures];

  // Optional bounding polygon feature
  if (options.includeBoundary || options.boundaryRing) {
    const boundarySource = options.boundaryRing ?? venues;
    const boundary = generateFolderBoundingPolygon(boundarySource, {
      folderName: isFolder ? input.name : undefined,
    });
    if (boundary) {
      features.push(boundary);
    }
  }

  const collection: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  if (isFolder && input.id) {
    collection.metadata = {
      folderId: input.id,
      folderName: input.name,
      description: input.description ?? null,
      exportedAt: (exportedAt ?? new Date()).toISOString(),
      featureCount: features.length,
      generator: "WorkSphere",
    };
  }

  return collection;
}

export function venuesToKml(
  input: GeoExportFolder | GeoExportVenue[],
  folderOrDate?: GeoExportFolder | Date,
): string {
  let folder: GeoExportFolder;
  let venues: GeoExportVenue[];
  let exportDate = new Date();

  if (Array.isArray(input)) {
    venues = input;
    folder = (folderOrDate && !(folderOrDate instanceof Date))
      ? folderOrDate
      : { name: "Collection" };
    if (folderOrDate instanceof Date) {
      exportDate = folderOrDate;
    }
  } else {
    folder = input;
    venues = input.items ? input.items.map((i) => i.venue) : [];
    if (folderOrDate instanceof Date) {
      exportDate = folderOrDate;
    }
  }

  const validVenues = venues.filter(hasValidCoordinates);

  const placemarks = validVenues
    .map((venue) => {
      const amenities = normalizeVenueAmenities(venue);
      const amenitiesText = amenities.length ? amenities.join(", ") : "None listed";
      const addressText = venue.address?.trim() || "Not available";
      const url = getVenueWorkSphereUrl(venue.id);

      const description = `<![CDATA[
        <b>Address:</b> ${escapeHtml(addressText)}<br/>
        <b>Category:</b> ${escapeHtml(venue.category || "cafe")}<br/>
        <b>Amenities:</b> ${escapeHtml(amenitiesText)}<br/>
        <a href="${escapeHtml(url)}">View on WorkSphere</a>
      ]]>`.trim();

      return `    <Placemark id="venue-${escapeHtml(venue.id)}">
      <name>${escapeHtml(venue.name)}</name>
      <description>${description}</description>
      ${venue.address ? `      <address>${escapeHtml(venue.address)}</address>` : ""}
      <Point>
        <coordinates>${venue.longitude},${venue.latitude},0</coordinates>
      </Point>
    </Placemark>`;
    })
    .join("\n");

  const folderDescription = folder.description
    ? `    <description>${escapeHtml(folder.description)}</description>\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="${KML_NAMESPACE}">
  <Document>
    <name>${escapeHtml(folder.name)}</name>
${folderDescription}    <ExtendedData>
      ${folder.id ? `<Data name="folderId"><value>${escapeHtml(folder.id)}</value></Data>` : ""}
      <Data name="exportedAt"><value>${exportDate.toISOString()}</value></Data>
      <Data name="generator"><value>WorkSphere</value></Data>
    </ExtendedData>
${placemarks}
  </Document>
</kml>`.trim();
}
