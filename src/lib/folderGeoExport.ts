import { appUrl } from "@/lib/appUrl";
import { escapeHtml } from "@/lib/html";

/**
 * Geographic exports for saved venue collections (#3477).
 *
 * - GeoJSON follows RFC 7946: a root FeatureCollection of Point Features with
 *   WGS84 coordinates in [longitude, latitude] order.
 * - KML follows OGC KML 2.2: one Placemark per venue inside a Document, with
 *   `<coordinates>longitude,latitude,0</coordinates>`.
 *
 * Venues without usable coordinates are excluded from both formats rather
 * than emitted as invalid or misleading geometry (see `hasValidCoordinates`).
 */

export const GEO_EXPORT_FORMATS = ["geojson", "kml"] as const;
export type GeoExportFormat = (typeof GEO_EXPORT_FORMATS)[number];

export const GEOJSON_CONTENT_TYPE = "application/geo+json";
export const KML_CONTENT_TYPE = "application/vnd.google-earth.kml+xml";
export const KML_NAMESPACE = "http://www.opengis.net/kml/2.2";

/** Boolean Venue columns exported as amenities, with human-readable labels. */
const AMENITY_FLAGS = [
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

type AmenityFlag = (typeof AMENITY_FLAGS)[number][0];

/**
 * Prisma `select` for exactly the Venue columns the exporters read, so no
 * unrelated/internal venue fields are loaded or serialized.
 */
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
} as const satisfies Record<keyof GeoExportVenue, true>;

export type GeoExportVenue = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  category: string;
  wifiQuality?: number | null;
  wifiSpeed?: number | null;
} & { [K in AmenityFlag]?: boolean | null };

export type GeoExportFolder = {
  name: string;
  description?: string | null;
};

export type GeoJsonFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    name: string;
    address: string | null;
    category: string;
    amenities: string[];
    workSphereUrl: string;
  };
};

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

/** Case-insensitive `?format=` parsing; returns null for missing/unsupported values. */
export function parseGeoExportFormat(
  value: string | null | undefined,
): GeoExportFormat | null {
  const normalized = value?.trim().toLowerCase();
  return (GEO_EXPORT_FORMATS as readonly string[]).includes(normalized ?? "")
    ? (normalized as GeoExportFormat)
    : null;
}

/**
 * True when a venue has finite WGS84 coordinates within range.
 *
 * (0, 0) is rejected because WorkSphere uses it as a "coordinates unknown"
 * placeholder (e.g. `api/favorites/tags/sync` creates stub venues there);
 * exporting it would drop pins into the Gulf of Guinea.
 */
export function hasValidCoordinates(
  venue: Pick<GeoExportVenue, "latitude" | "longitude">,
): boolean {
  const { latitude, longitude } = venue;
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return false;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return !(latitude === 0 && longitude === 0);
}

/** Normalizes the Venue boolean amenity columns into readable labels. */
export function normalizeVenueAmenities(venue: GeoExportVenue): string[] {
  const amenities: string[] = [];
  // A Wi-Fi speed/quality measurement implies the venue offers Wi-Fi.
  if ((venue.wifiSpeed ?? 0) > 0 || (venue.wifiQuality ?? 0) > 0) {
    amenities.push("Wi-Fi");
  }
  for (const [flag, label] of AMENITY_FLAGS) {
    if (venue[flag] === true) amenities.push(label);
  }
  return amenities;
}

/** Canonical WorkSphere venue page URL (`/venues/[id]`). */
export function getVenueWorkSphereUrl(venueId: string): string {
  return appUrl(`/venues/${encodeURIComponent(venueId)}`);
}

/**
 * Deterministic, header-safe download filename derived from the folder name.
 * Only `[a-z0-9-]` survives, so quotes, slashes, CR/LF etc. can never break
 * the `Content-Disposition` header.
 */
export function buildGeoExportFilename(
  folderName: string,
  format: GeoExportFormat,
): string {
  const slug = (folderName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `${slug || "collection"}.${format}`;
}

export function generateGeoJson(
  venues: GeoExportVenue[],
): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: venues.filter(hasValidCoordinates).map((venue) => ({
      type: "Feature",
      id: venue.id,
      geometry: {
        type: "Point",
        // RFC 7946 §3.1.1: [longitude, latitude]
        coordinates: [venue.longitude, venue.latitude],
      },
      properties: {
        name: venue.name,
        address: venue.address ?? null,
        category: venue.category,
        amenities: normalizeVenueAmenities(venue),
        workSphereUrl: getVenueWorkSphereUrl(venue.id),
      },
    })),
  };
}

// Characters that are not allowed anywhere in an XML 1.0 document, even when
// escaped: C0 controls other than tab/LF/CR, lone surrogates, U+FFFE/U+FFFF.
const INVALID_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Escapes text for an XML text node or attribute (`& < > " '`). */
export function escapeXml(value: unknown): string {
  return escapeHtml(String(value ?? "").replace(INVALID_XML_CHARS, ""));
}

/** Fixed-point coordinate text (no exponent notation, ~1cm precision). */
function formatKmlNumber(value: number): string {
  const text = value
    .toFixed(7)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}

/**
 * HTML shown in the Placemark balloon. Every venue value is HTML-escaped
 * here; the whole fragment is then XML-escaped again when written into
 * `<description>`, so venue data can neither inject markup nor break the
 * KML document.
 */
function buildPlacemarkDescriptionHtml(venue: GeoExportVenue): string {
  const amenities = normalizeVenueAmenities(venue);
  const lines = [
    `<b>Address:</b> ${escapeHtml(venue.address?.trim() || "Not available")}`,
    `<b>Category:</b> ${escapeHtml(venue.category)}`,
    `<b>Amenities:</b> ${escapeHtml(amenities.length ? amenities.join(", ") : "None listed")}`,
    `<a href="${escapeHtml(getVenueWorkSphereUrl(venue.id))}">View on WorkSphere</a>`,
  ];
  return lines.join("<br/>");
}

export function generateKml(
  venues: GeoExportVenue[],
  folder: GeoExportFolder,
): string {
  const placemarks = venues.filter(hasValidCoordinates).map((venue) =>
    [
      "    <Placemark>",
      `      <name>${escapeXml(venue.name)}</name>`,
      `      <description>${escapeXml(buildPlacemarkDescriptionHtml(venue))}</description>`,
      "      <Point>",
      // KML 2.2: longitude,latitude[,altitude]
      `        <coordinates>${formatKmlNumber(venue.longitude)},${formatKmlNumber(venue.latitude)},0</coordinates>`,
      "      </Point>",
      "    </Placemark>",
    ].join("\n"),
  );

  const description = folder.description?.trim();

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<kml xmlns="${KML_NAMESPACE}">`,
    "  <Document>",
    `    <name>${escapeXml(folder.name)}</name>`,
    ...(description
      ? [`    <description>${escapeXml(description)}</description>`]
      : []),
    ...placemarks,
    "  </Document>",
    "</kml>",
    "",
  ].join("\n");
}
