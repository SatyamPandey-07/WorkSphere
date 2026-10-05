/**
 * Geographic Exporter (GeoJSON and KML).
 *
 * Implements RFC 7946 GeoJSON and OGC KML 2.2 export formats
 * for saved venues, collections, and favorites.
 */

import { appUrl } from "@/lib/appUrl";
import { escapeHtml } from "@/lib/html";

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
  id: string;
  name: string;
  description?: string | null;
  userId?: string;
  items: Array<{
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
  return (
    venue.latitude >= -90 &&
    venue.latitude <= 90 &&
    venue.longitude >= -180 &&
    venue.longitude <= 180
  );
}

export function extractAmenities(venue: GeoExportVenue): string[] {
  const result: string[] = [];
  for (const [key, label] of AMENITY_FLAGS) {
    if (venue[key] === true) {
      result.push(label);
    }
  }
  return result;
}

export function venueProperties(venue: GeoExportVenue) {
  return {
    id: venue.id,
    name: venue.name,
    category: venue.category,
    address: venue.address,
    wifiQuality: venue.wifiQuality ?? null,
    wifiSpeed: venue.wifiSpeed ?? null,
    amenities: extractAmenities(venue),
    url: appUrl(`/venues/${venue.id}`),
  };
}

export function venuesToGeoJson(
  folder: GeoExportFolder,
  exportedAt = new Date(),
) {
  const features = folder.items
    .map((item) => item.venue)
    .filter(hasValidCoordinates)
    .map((venue) => ({
      type: "Feature" as const,
      id: venue.id,
      geometry: {
        type: "Point" as const,
        coordinates: [venue.longitude, venue.latitude],
      },
      properties: venueProperties(venue),
    }));

  return {
    type: "FeatureCollection" as const,
    metadata: {
      folderId: folder.id,
      folderName: folder.name,
      description: folder.description ?? null,
      exportedAt: exportedAt.toISOString(),
      featureCount: features.length,
      generator: "WorkSphere",
    },
    features,
  };
}

export function venuesToKml(
  folder: GeoExportFolder,
  exportedAt = new Date(),
): string {
  const validVenues = folder.items
    .map((item) => item.venue)
    .filter(hasValidCoordinates);

  const placemarks = validVenues
    .map((venue) => {
      const amenities = extractAmenities(venue);
      const amenitiesHtml =
        amenities.length > 0
          ? `<li><strong>Amenities:</strong> ${escapeHtml(amenities.join(", "))}</li>`
          : "";

      const wifiHtml =
        typeof venue.wifiQuality === "number"
          ? `<li><strong>WiFi Quality:</strong> ${venue.wifiQuality}/5</li>`
          : "";

      const speedHtml =
        typeof venue.wifiSpeed === "number"
          ? `<li><strong>WiFi Speed:</strong> ${venue.wifiSpeed} Mbps</li>`
          : "";

      const addressHtml = venue.address
        ? `<li><strong>Address:</strong> ${escapeHtml(venue.address)}</li>`
        : "";

      const url = appUrl(`/venues/${venue.id}`);

      const description = `<![CDATA[
        <div style="font-family:sans-serif;line-height:1.4">
          <p><strong>Category:</strong> ${escapeHtml(venue.category)}</p>
          <ul>
            ${addressHtml}
            ${wifiHtml}
            ${speedHtml}
            ${amenitiesHtml}
          </ul>
          <p><a href="${url}">View on WorkSphere</a></p>
        </div>
      ]]>`.trim();

      return `    <Placemark id="venue-${escapeHtml(venue.id)}">
      <name>${escapeHtml(venue.name)}</name>
      <description>${description}</description>
      ${venue.address ? `<address>${escapeHtml(venue.address)}</address>` : ""}
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
      <Data name="folderId"><value>${escapeHtml(folder.id)}</value></Data>
      <Data name="exportedAt"><value>${exportedAt.toISOString()}</value></Data>
      <Data name="generator"><value>WorkSphere</value></Data>
    </ExtendedData>
${placemarks}
  </Document>
</kml>`.trim();
}
