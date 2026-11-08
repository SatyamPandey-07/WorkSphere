import { appUrl } from "@/lib/appUrl";
import { escapeHtml } from "@/lib/html";
import {
  hasValidCoordinates,
  GEOJSON_CONTENT_TYPE,
  KML_CONTENT_TYPE,
  KML_NAMESPACE,
  GEO_EXPORT_FORMATS,
  type GeoExportFormat,
  parseGeoExportFormat,
  escapeXml,
} from "@/lib/folderGeoExport";

export {
  GEOJSON_CONTENT_TYPE,
  KML_CONTENT_TYPE,
  KML_NAMESPACE,
  GEO_EXPORT_FORMATS,
  type GeoExportFormat,
  parseGeoExportFormat,
  hasValidCoordinates,
  escapeXml,
};

export interface FavoriteExportTag {
  id?: string;
  name: string;
  color?: string;
}

export interface FavoriteExportVenue {
  id: string;
  placeId?: string;
  name: string;
  latitude: number;
  longitude: number;
  category: string;
  address?: string | null;
  rating?: number | null;
  wifiQuality?: number | null;
  wifiSpeed?: number | null;
  hasOutlets?: boolean;
  noiseLevel?: string | null;
}

export interface FavoriteExportItem {
  id: string;
  venueId: string;
  notes?: string | null;
  createdAt?: string | Date;
  venue: FavoriteExportVenue;
  tags?: FavoriteExportTag[];
}

export interface FavoriteGeoJsonFeature {
  type: "Feature";
  id: string;
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [longitude, latitude]
  };
  properties: {
    venueId: string;
    name: string;
    category: string;
    address: string | null;
    rating: number | null;
    tags: string[];
    notes: string | null;
    wifiQuality: number | null;
    wifiSpeed: number | null;
    hasOutlets: boolean;
    noiseLevel: string | null;
    workSphereUrl: string;
  };
}

export interface FavoriteGeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: FavoriteGeoJsonFeature[];
}

export function generateFavoritesGeoJson(
  favorites: FavoriteExportItem[],
): FavoriteGeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: favorites
      .filter((fav) => fav.venue && hasValidCoordinates(fav.venue))
      .map((fav) => {
        const v = fav.venue;
        const tagNames = (fav.tags || []).map((t) => t.name);
        return {
          type: "Feature",
          id: fav.id,
          geometry: {
            type: "Point",
            coordinates: [v.longitude, v.latitude],
          },
          properties: {
            venueId: v.id,
            name: v.name,
            category: v.category,
            address: v.address ?? null,
            rating: typeof v.rating === "number" ? v.rating : null,
            tags: tagNames,
            notes: fav.notes ?? null,
            wifiQuality: typeof v.wifiQuality === "number" ? v.wifiQuality : null,
            wifiSpeed: typeof v.wifiSpeed === "number" ? v.wifiSpeed : null,
            hasOutlets: Boolean(v.hasOutlets),
            noiseLevel: v.noiseLevel ?? null,
            workSphereUrl: appUrl(`/venues/${encodeURIComponent(v.id)}`),
          },
        };
      }),
  };
}

function formatKmlNumber(value: number): string {
  const text = value
    .toFixed(7)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}

function buildFavoritePlacemarkDescriptionHtml(fav: FavoriteExportItem): string {
  const v = fav.venue;
  const tagNames = (fav.tags || []).map((t) => t.name);
  const lines = [
    `<b>Address:</b> ${escapeHtml(v.address?.trim() || "Not available")}`,
    `<b>Category:</b> ${escapeHtml(v.category || "Uncategorized")}`,
    `<b>Rating:</b> ${v.rating != null ? escapeHtml(v.rating.toString()) : "No rating"}`,
    `<b>Tags:</b> ${escapeHtml(tagNames.length ? tagNames.join(", ") : "None")}`,
    ...(fav.notes?.trim() ? [`<b>Notes:</b> ${escapeHtml(fav.notes.trim())}`] : []),
    `<a href="${escapeHtml(appUrl(`/venues/${encodeURIComponent(v.id)}`))}">View on WorkSphere</a>`,
  ];
  return lines.join("<br/>");
}

export function generateFavoritesKml(
  favorites: FavoriteExportItem[],
  collectionName = "My Saved Venues",
): string {
  const placemarks = favorites
    .filter((fav) => fav.venue && hasValidCoordinates(fav.venue))
    .map((fav) => {
      const v = fav.venue;
      return [
        "    <Placemark>",
        `      <name>${escapeXml(v.name)}</name>`,
        `      <description>${escapeXml(buildFavoritePlacemarkDescriptionHtml(fav))}</description>`,
        "      <Point>",
        `        <coordinates>${formatKmlNumber(v.longitude)},${formatKmlNumber(v.latitude)},0</coordinates>`,
        "      </Point>",
        "    </Placemark>",
      ].join("\n");
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<kml xmlns="${KML_NAMESPACE}">`,
    "  <Document>",
    `    <name>${escapeXml(collectionName)}</name>`,
    "    <description>Saved WorkSphere venues collection</description>",
    ...placemarks,
    "  </Document>",
    "</kml>",
    "",
  ].join("\n");
}
