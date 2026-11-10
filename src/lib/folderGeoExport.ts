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
  type GeoJsonFeature,
  type GeoJsonPointFeature,
  type GeoJsonPolygonFeature,
  type GeoJsonFeatureCollection,
  hasValidCoordinates,
  normalizeVenueAmenities,
  extractAmenities,
  getVenueWorkSphereUrl,
  venueProperties,
  venuesToGeoJson,
  venuesToKml,
  generateFolderBoundingPolygon,
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
  escapeXml,
  formatKmlNumber,
  INVALID_XML_CHARS,
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
  type GeoJsonFeature,
  type GeoJsonPointFeature,
  type GeoJsonPolygonFeature,
  type GeoJsonFeatureCollection,
  hasValidCoordinates,
  normalizeVenueAmenities,
  extractAmenities,
  getVenueWorkSphereUrl,
  venueProperties,
  venuesToGeoJson,
  venuesToKml,
  venuesToGeoJson as generateGeoJson,
  venuesToKml as generateKml,
  generateFolderBoundingPolygon,
  generateFolderBoundingPolygon as generateBoundingPolygon,
  generateFolderBoundingPolygon as createBoundingPolygonFeature,
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
  escapeXml,
  formatKmlNumber,
  INVALID_XML_CHARS,
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
