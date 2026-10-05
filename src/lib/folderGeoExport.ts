/**
 * Folder Geographic Export re-export bridge.
 *
 * Re-exports from @/lib/export/domain/geoExporter.
 */

import {
  GEO_EXPORT_FORMATS,
  type GeoExportFormat,
  GEOJSON_CONTENT_TYPE,
  KML_CONTENT_TYPE,
  KML_NAMESPACE,
  AMENITY_FLAGS,
  type AmenityFlag,
  GEO_EXPORT_VENUE_SELECT,
  type GeoExportVenue,
  type GeoExportFolder,
  hasValidCoordinates,
  extractAmenities,
  venueProperties,
  venuesToGeoJson,
  venuesToKml,
} from "./export/domain/geoExporter";

export {
  GEO_EXPORT_FORMATS,
  type GeoExportFormat,
  GEOJSON_CONTENT_TYPE,
  KML_CONTENT_TYPE,
  KML_NAMESPACE,
  AMENITY_FLAGS,
  type AmenityFlag,
  GEO_EXPORT_VENUE_SELECT,
  type GeoExportVenue,
  type GeoExportFolder,
  hasValidCoordinates,
  extractAmenities,
  venueProperties,
  venuesToGeoJson,
  venuesToKml,
  venuesToGeoJson as generateGeoJson,
  venuesToKml as generateKml,
};

export function parseGeoExportFormat(
  value: string | null | undefined,
): GeoExportFormat | null {
  const normalized = value?.trim().toLowerCase();
  return (GEO_EXPORT_FORMATS as readonly string[]).includes(normalized ?? "")
    ? (normalized as GeoExportFormat)
    : null;
}

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

const INVALID_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
