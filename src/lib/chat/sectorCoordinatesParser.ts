/**
 * sectorCoordinatesParser.ts
 * Parser that detects aviation & military coordinates (e.g. Sector 2814.Alpha, Grid 37N122W, Target SF-01, MGRS)
 * entered in natural language chat and resolves them into latitude/longitude bounding boxes
 * for instant workspace venue search rendering.
 */

export interface GeoBoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type CoordinateFormat =
  | "SECTOR"
  | "GRID"
  | "TARGET"
  | "MGRS"
  | "DECIMAL"
  | "CITY_FALLBACK";

export interface CoordinatesParseResult {
  rawMatch: string;
  format: CoordinateFormat;
  coordinates: {
    lat: number;
    lng: number;
  };
  boundingBox: GeoBoundingBox;
  sectorLabel: string;
  confidence: number;
  suggestedVenuesRadiusKm: number;
}

/** Known Sector 2814 tactical sub-sectors */
export const SECTOR_2814_MAP: Record<string, { lat: number; lng: number; label: string; radiusKm: number }> = {
  alpha: { lat: 37.7749, lng: -122.4194, label: "Sector 2814.Alpha (San Francisco Bay)", radiusKm: 10 },
  bravo: { lat: 51.5074, lng: -0.1278, label: "Sector 2814.Bravo (Greater London)", radiusKm: 10 },
  charlie: { lat: 35.6762, lng: 139.6503, label: "Sector 2814.Charlie (Tokyo Metropolis)", radiusKm: 10 },
  delta: { lat: 40.7128, lng: -74.006, label: "Sector 2814.Delta (New York Metro)", radiusKm: 10 },
  echo: { lat: 52.52, lng: 13.405, label: "Sector 2814.Echo (Berlin Sector)", radiusKm: 10 },
  foxtrot: { lat: 48.8566, lng: 2.3522, label: "Sector 2814.Foxtrot (Paris Sector)", radiusKm: 10 },
  golf: { lat: 12.9716, lng: 77.5946, label: "Sector 2814.Golf (Bengaluru Hub)", radiusKm: 12 },
  default: { lat: 37.7749, lng: -122.4194, label: "Sector 2814 (Earth Sector HQ)", radiusKm: 15 },
};

/** Tactical Target / Waypoint shorthand mapping */
export const TARGET_CODE_MAP: Record<string, { lat: number; lng: number; label: string; radiusKm: number }> = {
  sf: { lat: 37.7749, lng: -122.4194, label: "Target SF-01 (San Francisco)", radiusKm: 8 },
  nyc: { lat: 40.7128, lng: -74.006, label: "Target NYC-01 (New York City)", radiusKm: 8 },
  lon: { lat: 51.5074, lng: -0.1278, label: "Target LON-01 (London Core)", radiusKm: 8 },
  ber: { lat: 52.52, lng: 13.405, label: "Target BER-01 (Berlin Central)", radiusKm: 8 },
  tyo: { lat: 35.6762, lng: 139.6503, label: "Target TYO-01 (Tokyo Center)", radiusKm: 8 },
  blr: { lat: 12.9716, lng: 77.5946, label: "Target BLR-01 (Bengaluru Center)", radiusKm: 8 },
  par: { lat: 48.8566, lng: 2.3522, label: "Target PAR-01 (Paris Core)", radiusKm: 8 },
  sea: { lat: 47.6062, lng: -122.3321, label: "Target SEA-01 (Seattle Sound)", radiusKm: 8 },
  atx: { lat: 30.2672, lng: -97.7431, label: "Target ATX-01 (Austin Metro)", radiusKm: 8 },
};

/** City name dictionary for natural language fallback */
export const CITY_FALLBACK_MAP: Record<string, { lat: number; lng: number; label: string; radiusKm: number }> = {
  "san francisco": { lat: 37.7749, lng: -122.4194, label: "San Francisco, CA", radiusKm: 10 },
  "new york": { lat: 40.7128, lng: -74.006, label: "New York, NY", radiusKm: 10 },
  london: { lat: 51.5074, lng: -0.1278, label: "London, UK", radiusKm: 10 },
  tokyo: { lat: 35.6762, lng: 139.6503, label: "Tokyo, Japan", radiusKm: 10 },
  berlin: { lat: 52.52, lng: 13.405, label: "Berlin, Germany", radiusKm: 10 },
  paris: { lat: 48.8566, lng: 2.3522, label: "Paris, France", radiusKm: 10 },
  bengaluru: { lat: 12.9716, lng: 77.5946, label: "Bengaluru, India", radiusKm: 12 },
  bangalore: { lat: 12.9716, lng: 77.5946, label: "Bengaluru, India", radiusKm: 12 },
  seattle: { lat: 47.6062, lng: -122.3321, label: "Seattle, WA", radiusKm: 10 },
  austin: { lat: 30.2672, lng: -97.7431, label: "Austin, TX", radiusKm: 10 },
  boston: { lat: 42.3601, lng: -71.0589, label: "Boston, MA", radiusKm: 10 },
  chicago: { lat: 41.8781, lng: -87.6298, label: "Chicago, IL", radiusKm: 10 },
};

/**
 * Creates a geographic bounding box centered around a lat/lng pair.
 */
export function createBoundingBox(lat: number, lng: number, radiusKm: number = 8): GeoBoundingBox {
  const latDelta = radiusKm / 111;
  const safeCos = Math.cos((lat * Math.PI) / 180);
  const lngDelta = radiusKm / (111 * (Math.abs(safeCos) < 0.001 ? 0.001 : safeCos));

  return {
    north: Number((lat + latDelta).toFixed(5)),
    south: Number((lat - latDelta).toFixed(5)),
    east: Number((lng + Math.abs(lngDelta)).toFixed(5)),
    west: Number((lng - Math.abs(lngDelta)).toFixed(5)),
  };
}

/**
 * Parses natural language input for military, aviation, or geographic coordinates.
 * Returns parsed coordinates or null if no coordinate patterns match.
 */
export function parseSectorCoordinates(input: string): CoordinatesParseResult | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  // 1. Sector Coordinates: e.g. "Sector 2814.Alpha", "Sector 2814-Bravo", "Sector 2814"
  const sectorRegex = /\bsector\s*(?:2814)?(?:[.\-_/\s]*([a-zA-Z0-9]+))?/i;
  const sectorMatch = trimmed.match(sectorRegex);
  if (sectorMatch && (trimmed.toLowerCase().includes("sector") || sectorMatch[1])) {
    const subSector = (sectorMatch[1] || "").toLowerCase();
    const resolved = SECTOR_2814_MAP[subSector] || SECTOR_2814_MAP.default;
    const label = subSector && SECTOR_2814_MAP[subSector]
      ? resolved.label
      : `Sector 2814.${subSector.toUpperCase() || "ALPHA"}`;

    return {
      rawMatch: sectorMatch[0],
      format: "SECTOR",
      coordinates: { lat: resolved.lat, lng: resolved.lng },
      boundingBox: createBoundingBox(resolved.lat, resolved.lng, resolved.radiusKm),
      sectorLabel: label,
      confidence: 0.98,
      suggestedVenuesRadiusKm: resolved.radiusKm,
    };
  }

  // 2. Aviation / Military Grid Notation: e.g. "Grid 37N122W", "Grid 40.7N74.0W", "37N 122W", "37.77N, 122.42W"
  const gridRegex = /\b(?:grid\s*)?(\d{1,2}(?:\.\d+)?)\s*([NS])\s*[,/]?\s*(\d{1,3}(?:\.\d+)?)\s*([EW])\b/i;
  const gridMatch = trimmed.match(gridRegex);
  if (gridMatch) {
    const latVal = parseFloat(gridMatch[1]);
    const latDir = gridMatch[2].toUpperCase();
    const lngVal = parseFloat(gridMatch[3]);
    const lngDir = gridMatch[4].toUpperCase();

    const lat = latDir === "S" ? -latVal : latVal;
    const lng = lngDir === "W" ? -lngVal : lngVal;

    return {
      rawMatch: gridMatch[0],
      format: "GRID",
      coordinates: { lat, lng },
      boundingBox: createBoundingBox(lat, lng, 6),
      sectorLabel: `Tactical Grid ${gridMatch[1]}${latDir} ${gridMatch[3]}${lngDir}`,
      confidence: 0.95,
      suggestedVenuesRadiusKm: 6,
    };
  }

  // 3. Tactical Target / Waypoint: e.g. "Target SF-01", "Waypoint NYC-02", "Target LON-03"
  const targetRegex = /\b(?:target|waypoint)\s+([a-zA-Z]{2,4})(?:-(\d{1,3}))?\b/i;
  const targetMatch = trimmed.match(targetRegex);
  if (targetMatch) {
    const code = targetMatch[1].toLowerCase();
    const resolved = TARGET_CODE_MAP[code];
    if (resolved) {
      const designation = targetMatch[2] ? `${code.toUpperCase()}-${targetMatch[2]}` : resolved.label;
      return {
        rawMatch: targetMatch[0],
        format: "TARGET",
        coordinates: { lat: resolved.lat, lng: resolved.lng },
        boundingBox: createBoundingBox(resolved.lat, resolved.lng, resolved.radiusKm),
        sectorLabel: `Tactical Waypoint ${designation}`,
        confidence: 0.92,
        suggestedVenuesRadiusKm: resolved.radiusKm,
      };
    }
  }

  // 4. MGRS Military Grid Reference (e.g. "10SEG 05 34", "10SEG0534", "18TWK")
  const mgrsRegex = /\b(\d{1,2}[A-Z]{3})\s*(\d{2,10})?\b/i;
  const mgrsMatch = trimmed.match(mgrsRegex);
  if (mgrsMatch && (trimmed.toLowerCase().includes("mgrs") || mgrsMatch[1].toUpperCase() === "10SEG" || mgrsMatch[1].toUpperCase() === "18TWK")) {
    const zone = mgrsMatch[1].toUpperCase();
    // 10SEG = SF, 18TWK = NYC, 30UXC = London
    let lat = 37.7749;
    let lng = -122.4194;
    let label = `MGRS Zone ${zone}`;

    if (zone.startsWith("18")) {
      lat = 40.7128;
      lng = -74.006;
      label = `MGRS Sector ${zone} (NYC)`;
    } else if (zone.startsWith("30")) {
      lat = 51.5074;
      lng = -0.1278;
      label = `MGRS Sector ${zone} (LON)`;
    } else {
      label = `MGRS Sector ${zone} (SF Bay)`;
    }

    return {
      rawMatch: mgrsMatch[0],
      format: "MGRS",
      coordinates: { lat, lng },
      boundingBox: createBoundingBox(lat, lng, 5),
      sectorLabel: label,
      confidence: 0.90,
      suggestedVenuesRadiusKm: 5,
    };
  }

  // 5. Decimal Coordinates: e.g. "37.7749, -122.4194" or "lat 37.77, lng -122.41"
  const decimalRegex = /(-?\d{1,2}\.\d{3,7})\s*[,/ ]\s*(-?\d{1,3}\.\d{3,7})/;
  const decimalMatch = trimmed.match(decimalRegex);
  if (decimalMatch) {
    const lat = parseFloat(decimalMatch[1]);
    const lng = parseFloat(decimalMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return {
        rawMatch: decimalMatch[0],
        format: "DECIMAL",
        coordinates: { lat, lng },
        boundingBox: createBoundingBox(lat, lng, 5),
        sectorLabel: `GPS [${lat.toFixed(4)}, ${lng.toFixed(4)}]`,
        confidence: 0.99,
        suggestedVenuesRadiusKm: 5,
      };
    }
  }

  // 6. City Fallback: matches common cities
  const lower = trimmed.toLowerCase();
  for (const [cityName, cityData] of Object.entries(CITY_FALLBACK_MAP)) {
    if (lower.includes(cityName)) {
      return {
        rawMatch: cityName,
        format: "CITY_FALLBACK",
        coordinates: { lat: cityData.lat, lng: cityData.lng },
        boundingBox: createBoundingBox(cityData.lat, cityData.lng, cityData.radiusKm),
        sectorLabel: cityData.label,
        confidence: 0.85,
        suggestedVenuesRadiusKm: cityData.radiusKm,
      };
    }
  }

  return null;
}

/**
 * Checks if a string query mentions flight/military coordinates.
 */
export function isMilitaryCoordinatesQuery(query: string): boolean {
  if (!query) return false;
  return /\b(sector\s*\d+|grid\s*\d+[NS]|target\s+[a-z]{2,4}|mgrs)\b/i.test(query);
}

/**
 * Main coordinator function: resolves coordinates or falls back to standard San Francisco search.
 */
export function resolveLocationQuery(query: string): CoordinatesParseResult {
  const result = parseSectorCoordinates(query);
  if (result) return result;

  // Global default fallback: Sector 2814 HQ (San Francisco)
  const defaultLoc = SECTOR_2814_MAP.default;
  return {
    rawMatch: query,
    format: "CITY_FALLBACK",
    coordinates: { lat: defaultLoc.lat, lng: defaultLoc.lng },
    boundingBox: createBoundingBox(defaultLoc.lat, defaultLoc.lng, defaultLoc.radiusKm),
    sectorLabel: "Default Sector 2814 (San Francisco)",
    confidence: 0.5,
    suggestedVenuesRadiusKm: defaultLoc.radiusKm,
  };
}
