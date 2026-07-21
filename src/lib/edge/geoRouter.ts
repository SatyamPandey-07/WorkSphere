/**
 * Edge Geolocation Router
 *
 * Routes WebSocket connections to the nearest regional PartyKit node
 * based on IP geolocation headers (CF-IPCountry, X-Vercel-IP-Country).
 * Maintains cross-region state synchronization for real-time presence.
 */

export type Region =
  | "us-east"
  | "us-west"
  | "eu-west"
  | "eu-central"
  | "ap-south"
  | "ap-northeast"
  | "sa-east";

export interface RegionNode {
  id: string;
  region: Region;
  host: string;
  port: number;
  weight: number;
  latencyMs: number;
  lastHeartbeat: number;
}

export interface GeoLocation {
  country: string;
  continent: string;
  latitude: number;
  longitude: number;
}

const REGION_COORDINATES: Record<Region, { lat: number; lng: number }> = {
  "us-east": { lat: 39.0438, lng: -77.4874 },
  "us-west": { lat: 37.3382, lng: -121.8863 },
  "eu-west": { lat: 53.3498, lng: -6.2603 },
  "eu-central": { lat: 50.1109, lng: 8.6821 },
  "ap-south": { lat: 19.076, lng: 72.8777 },
  "ap-northeast": { lat: 35.6762, lng: 139.6503 },
  "sa-east": { lat: -23.5505, lng: -46.6333 },
};

const CONTINENT_TO_REGION: Record<string, Region[]> = {
  NA: ["us-east", "us-west"],
  EU: ["eu-west", "eu-central"],
  AS: ["ap-south", "ap-northeast"],
  SA: ["sa-east"],
  AF: ["eu-west"],
  OC: ["ap-northeast"],
};

const COUNTRY_TO_REGION: Partial<Record<string, Region>> = {
  US: "us-east",
  CA: "us-east",
  BR: "sa-east",
  GB: "eu-west",
  DE: "eu-central",
  FR: "eu-west",
  IE: "eu-west",
  IN: "ap-south",
  JP: "ap-northeast",
  SG: "ap-south",
  AU: "ap-northeast",
  KR: "ap-northeast",
  NL: "eu-west",
  ES: "eu-west",
  IT: "eu-west",
  SE: "eu-central",
  PL: "eu-central",
  MX: "us-west",
  AR: "sa-east",
};

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function resolveRegion(geo: GeoLocation): Region {
  if (COUNTRY_TO_REGION[geo.country]) {
    return COUNTRY_TO_REGION[geo.country]!;
  }

  const regions = CONTINENT_TO_REGION[geo.continent] ?? ["us-east"];
  if (regions.length === 1) return regions[0];

  let bestRegion = regions[0];
  let bestDist = Infinity;

  for (const region of regions) {
    const coords = REGION_COORDINATES[region];
    const dist = haversineDistance(
      geo.latitude,
      geo.longitude,
      coords.lat,
      coords.lng,
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestRegion = region;
    }
  }

  return bestRegion;
}

export function extractGeoFromHeaders(
  headers: { get(name: string): string | null } | Headers,
): GeoLocation | null {
  const country =
    headers.get("cf-ipcountry") ??
    headers.get("x-vercel-ip-country") ??
    headers.get("x-country-code");

  const continent =
    headers.get("cf-ipcontinent") ?? headers.get("x-vercel-ip-continent");

  if (!country) return null;

  return {
    country,
    continent: continent ?? "NA",
    latitude: 0,
    longitude: 0,
  };
}

export function selectBestNode(
  nodes: RegionNode[],
  preferredRegion: Region,
): RegionNode | null {
  const regionNodes = nodes.filter(
    (n) => n.region === preferredRegion && n.latencyMs < 100,
  );

  if (regionNodes.length > 0) {
    return regionNodes.reduce((best, node) =>
      node.latencyMs < best.latencyMs ? node : best,
    );
  }

  const nearest = [...nodes]
    .sort((a, b) => {
      const aCoords = REGION_COORDINATES[a.region];
      const bCoords = REGION_COORDINATES[b.region];
      const prefCoords = REGION_COORDINATES[preferredRegion];
      const aDist = haversineDistance(
        prefCoords.lat,
        prefCoords.lng,
        aCoords.lat,
        aCoords.lng,
      );
      const bDist = haversineDistance(
        prefCoords.lat,
        prefCoords.lng,
        bCoords.lat,
        bCoords.lng,
      );
      return aDist - bDist;
    })
    .filter((n) => n.latencyMs < 200);

  return nearest[0] ?? nodes[0] ?? null;
}

export function getRegionCoordinates(region: Region) {
  return REGION_COORDINATES[region];
}
