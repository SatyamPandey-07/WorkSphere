export interface GeoCoordinate {
  lat: number;
  lng: number;
}

export interface VenueCandidate extends GeoCoordinate {
  id: string;
  name: string;
  availableSeats: number;
  totalSeats?: number;
  wifiMbps?: number;
  latencyMs?: number;
  transitDistanceKm?: number;
  rating?: number;
}

export interface AxialHexCell {
  q: number;
  r: number;
}

export interface VenueCluster extends AxialHexCell {
  cellId: string;
  cellRadiusKm: number;
  centroid: GeoCoordinate;
  venues: VenueCandidate[];
  venueCount: number;
  totalAvailableSeats: number;
  avgWifiMbps: number;
}

export interface RankingWeights {
  proximity?: number;
  transit?: number;
  wifi?: number;
  seats?: number;
}

export interface RankedVenueResult {
  venue: VenueCandidate;
  distanceKm: number;
  score: number;
  breakdown: {
    proximityScore: number;
    transitScore: number;
    wifiScore: number;
    seatScore: number;
  };
}

const EARTH_RADIUS_KM = 6371;
const SQRT3 = Math.sqrt(3);

export function isValidCoordinate(
  coord?: Partial<GeoCoordinate> | null
): coord is GeoCoordinate {
  if (!coord) return false;
  const { lat, lng } = coord;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function calculateHaversineKm(
  a: GeoCoordinate,
  b: GeoCoordinate
): number {
  if (!isValidCoordinate(a) || !isValidCoordinate(b)) {
    return Number.POSITIVE_INFINITY;
  }

  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLng = Math.sin(dLng / 2);
  const h =
    sinHalfLat * sinHalfLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfLng * sinHalfLng;

  const clampedH = Math.min(1, Math.max(0, h));
  const c = 2 * Math.atan2(Math.sqrt(clampedH), Math.sqrt(1 - clampedH));
  return Math.round(EARTH_RADIUS_KM * c * 1000) / 1000;
}

function axialRound(qFloat: number, rFloat: number): AxialHexCell {
  const sFloat = -qFloat - rFloat;
  let rq = Math.round(qFloat);
  let rr = Math.round(rFloat);
  const rs = Math.round(sFloat);

  const qDiff = Math.abs(rq - qFloat);
  const rDiff = Math.abs(rr - rFloat);
  const sDiff = Math.abs(rs - sFloat);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
}

export function latLngToAxialHex(
  coord: GeoCoordinate,
  cellRadiusKm = 1.5
): AxialHexCell {
  if (!isValidCoordinate(coord)) {
    return { q: 0, r: 0 };
  }
  const safeRadius =
    typeof cellRadiusKm === 'number' &&
    Number.isFinite(cellRadiusKm) &&
    cellRadiusKm > 0
      ? cellRadiusKm
      : 1.5;

  const kmPerDegLat = 111.32;
  const cosLat = Math.max(0.1, Math.cos(toRadians(coord.lat)));
  const kmPerDegLng = 111.32 * cosLat;

  const xKm = coord.lng * kmPerDegLng;
  const yKm = coord.lat * kmPerDegLat;

  const qFloat = ((2 / 3) * xKm) / safeRadius;
  const rFloat = ((-1 / 3) * xKm + (SQRT3 / 3) * yKm) / safeRadius;

  return axialRound(qFloat, rFloat);
}

export function hexDistance(a: AxialHexCell, b: AxialHexCell): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -a.q - a.r - (-b.q - b.r);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

export function clusterVenuesHexagonally(
  venues: readonly VenueCandidate[],
  cellRadiusKm = 1.5
): VenueCluster[] {
  const safeRadius =
    typeof cellRadiusKm === 'number' &&
    Number.isFinite(cellRadiusKm) &&
    cellRadiusKm > 0
      ? cellRadiusKm
      : 1.5;

  const buckets = new Map<
    string,
    { cell: AxialHexCell; items: VenueCandidate[] }
  >();

  for (const venue of venues) {
    if (!isValidCoordinate(venue)) continue;
    const cell = latLngToAxialHex(venue, safeRadius);
    const key = `${cell.q}:${cell.r}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.items.push(venue);
    } else {
      buckets.set(key, { cell, items: [venue] });
    }
  }

  const clusters: VenueCluster[] = [];
  for (const [key, { cell, items }] of buckets.entries()) {
    const latSum = items.reduce((acc, v) => acc + v.lat, 0);
    const lngSum = items.reduce((acc, v) => acc + v.lng, 0);
    const totalAvailableSeats = items.reduce(
      (acc, v) => acc + Math.max(0, v.availableSeats || 0),
      0
    );
    const wifiValues = items
      .map((v) => v.wifiMbps)
      .filter(
        (w): w is number => typeof w === 'number' && Number.isFinite(w) && w >= 0
      );
    const avgWifiMbps =
      wifiValues.length > 0
        ? Math.round(
            (wifiValues.reduce((a, b) => a + b, 0) / wifiValues.length) * 10
          ) / 10
        : 0;

    clusters.push({
      q: cell.q,
      r: cell.r,
      cellId: `hex:${safeRadius}km:${key}`,
      cellRadiusKm: safeRadius,
      centroid: {
        lat: Math.round((latSum / items.length) * 1_000_000) / 1_000_000,
        lng: Math.round((lngSum / items.length) * 1_000_000) / 1_000_000,
      },
      venues: items,
      venueCount: items.length,
      totalAvailableSeats,
      avgWifiMbps,
    });
  }

  return clusters.sort((a, b) => b.venueCount - a.venueCount);
}

export function rankVenuesForNomad(
  venues: readonly VenueCandidate[],
  origin: GeoCoordinate,
  options: {
    maxRadiusKm?: number;
    weights?: RankingWeights;
  } = {}
): RankedVenueResult[] {
  if (!isValidCoordinate(origin)) return [];

  const maxRadiusKm =
    typeof options.maxRadiusKm === 'number' &&
    Number.isFinite(options.maxRadiusKm) &&
    options.maxRadiusKm > 0
      ? options.maxRadiusKm
      : 10;

  const wProx = Math.max(0, options.weights?.proximity ?? 0.4);
  const wTrans = Math.max(0, options.weights?.transit ?? 0.25);
  const wWifi = Math.max(0, options.weights?.wifi ?? 0.2);
  const wSeats = Math.max(0, options.weights?.seats ?? 0.15);
  const weightSum = wProx + wTrans + wWifi + wSeats || 1;

  const ranked: RankedVenueResult[] = [];

  for (const venue of venues) {
    if (!isValidCoordinate(venue)) continue;
    const distanceKm = calculateHaversineKm(origin, venue);
    if (!Number.isFinite(distanceKm) || distanceKm > maxRadiusKm) continue;

    const proximityScore = Math.max(0, 1 - distanceKm / maxRadiusKm);
    const transitKm =
      typeof venue.transitDistanceKm === 'number' &&
      Number.isFinite(venue.transitDistanceKm) &&
      venue.transitDistanceKm >= 0
        ? venue.transitDistanceKm
        : 1.5;
    const transitScore = Math.max(0, 1 - Math.min(transitKm, 5) / 5);
    const wifiMbps =
      typeof venue.wifiMbps === 'number' &&
      Number.isFinite(venue.wifiMbps) &&
      venue.wifiMbps >= 0
        ? venue.wifiMbps
        : 50;
    const wifiScore = Math.min(1, wifiMbps / 200);
    const capacity = Math.max(
      1,
      venue.totalSeats ?? Math.max(venue.availableSeats, 10)
    );
    const openSeats = Math.max(0, venue.availableSeats || 0);
    const seatScore = Math.min(1, openSeats / capacity);

    const composite =
      (proximityScore * wProx +
        transitScore * wTrans +
        wifiScore * wWifi +
        seatScore * wSeats) /
      weightSum;

    ranked.push({
      venue,
      distanceKm,
      score: Math.round(composite * 1000) / 1000,
      breakdown: {
        proximityScore: Math.round(proximityScore * 1000) / 1000,
        transitScore: Math.round(transitScore * 1000) / 1000,
        wifiScore: Math.round(wifiScore * 1000) / 1000,
        seatScore: Math.round(seatScore * 1000) / 1000,
      },
    });
  }

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    return a.venue.id.localeCompare(b.venue.id);
  });
}
