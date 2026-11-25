import { isValidCoordinate as isValidCoordinatePair } from "@/lib/utils";
import type { Venue } from "@/types/venue";

const TILE_SIZE = 256;
const MERCATOR_MAX_LATITUDE = 85.0511287798066;
const EARTH_MEAN_RADIUS_METERS = 6_371_008.8;
const DEFAULT_RADIUS_PX = 60;
const DEFAULT_INDIVIDUAL_PINS_AT_ZOOM = 17;
const MAX_RADIUS_PX = 1024;
const QUADTREE_MAX_LEAF_CAPACITY = 16;
const QUADTREE_MAX_DEPTH = 20;
const CENTROID_EPSILON = 1e-12;

type VenueMetricFields = Pick<
  Venue,
  "id" | "wifiSpeed" | "noiseLevel" | "currentOccupancy" | "maxCapacity"
>;

type CoordinateFields =
  | {
      latitude: number;
      longitude: number;
      lat?: number;
      lng?: number;
    }
  | {
      lat: number;
      lng: number;
      latitude?: number;
      longitude?: number;
    };

/**
 * Venue coordinates can come from the Prisma shape (`latitude`/`longitude`)
 * or the shared client Venue shape (`lat`/`lng`). `avgDecibels` is an optional
 * adapter field from an associated VenueRating, not a Venue column.
 */
export type SpatialVenueInput = VenueMetricFields &
  CoordinateFields & {
    avgDecibels?: number | null;
  };

export interface GeographicBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface SpatialVenueClusterOptions {
  /** Integer Web Mercator zoom level in [1, 20]. */
  zoom: number;
  /** Inclusive geographic bounds; west > east represents an antimeridian crossing. */
  bounds?: GeographicBounds | null;
  /** Cluster radius in projected screen pixels, in (0, 1024]. Defaults to 60. */
  radiusPx?: number;
  /** Zoom at or above which every venue is returned as a singleton pin. Defaults to 17. */
  individualPinsAtZoom?: number;
}

export type NoiseCategory = "quiet" | "moderate" | "loud";

export type ExcludedVenueReason =
  | "invalid_coordinates"
  | "conflicting_coordinates"
  | "outside_bounds"
  | "empty_bounds";

export interface ExcludedVenue {
  venueId: string;
  reason: ExcludedVenueReason;
}

export interface VenueAvailabilityAggregate {
  /** Sum of valid per-venue currentOccupancy values, or null if none exist. */
  currentOccupancy: number | null;
  /** Sum of valid per-venue maxCapacity values, or null if none exist. */
  maxCapacity: number | null;
  /** Sum of maxCapacity - currentOccupancy where both are valid and consistent. */
  availableCapacity: number | null;
  /** Paired occupancy divided by paired capacity; null if no positive capacity exists. */
  occupancyRatio: number | null;
  currentOccupancyVenueCount: number;
  maxCapacityVenueCount: number;
  pairedAvailabilityVenueCount: number;
}

export interface SpatialVenueCluster {
  /** Deterministic key derived from zoom and the sorted member IDs. */
  id: string;
  venueCount: number;
  centroidLatitude: number;
  centroidLongitude: number;
  averageWifiSpeed: number | null;
  /** Categorical minimum, ordered quiet < moderate < loud. */
  minimumNoiseLevel: NoiseCategory | null;
  /** Minimum valid associated VenueRating.avgDecibels measurement. */
  minimumNoiseDecibels: number | null;
  availability: VenueAvailabilityAggregate;
  zoomLevel: number;
  memberVenueIds: string[];
}

export interface SpatialVenueClusteringResult {
  clusters: SpatialVenueCluster[];
  excludedVenues: ExcludedVenue[];
  /** Number of exact projected-distance checks performed by the quadtree query. */
  distanceComparisons: number;
}

interface ResolvedCoordinates {
  latitude: number;
  longitude: number;
}

interface PreparedVenue {
  input: SpatialVenueInput;
  id: string;
  latitude: number;
  longitude: number;
  x: number;
  y: number;
  index: number;
}

interface ProjectedLocation {
  x: number;
  y: number;
  order: number;
  members: PreparedVenue[];
}

interface QuadTreePoint {
  x: number;
  y: number;
  location: ProjectedLocation;
}

interface QuadTreeNode {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  depth: number;
  points: QuadTreePoint[];
  children: QuadTreeNode[] | null;
}

interface QueryRectangle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ValidatedOptions {
  zoom: number;
  radiusPx: number;
  individualPinsAtZoom: number;
  bounds: GeographicBounds | null | undefined;
}

const NOISE_ORDER: Record<NoiseCategory, number> = {
  quiet: 0,
  moderate: 1,
  loud: 2,
};

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateOptions(
  options: SpatialVenueClusterOptions,
): ValidatedOptions {
  if (!options || typeof options !== "object") {
    throw new TypeError("Clustering options are required.");
  }

  if (
    !Number.isInteger(options.zoom) ||
    options.zoom < 1 ||
    options.zoom > 20
  ) {
    throw new RangeError("zoom must be an integer from 1 through 20.");
  }

  const radiusPx =
    options.radiusPx === undefined ? DEFAULT_RADIUS_PX : options.radiusPx;
  if (
    typeof radiusPx !== "number" ||
    !Number.isFinite(radiusPx) ||
    radiusPx <= 0 ||
    radiusPx > MAX_RADIUS_PX
  ) {
    throw new RangeError("radiusPx must be finite and in the range (0, 1024].");
  }

  const individualPinsAtZoom =
    options.individualPinsAtZoom === undefined
      ? DEFAULT_INDIVIDUAL_PINS_AT_ZOOM
      : options.individualPinsAtZoom;
  if (
    !Number.isInteger(individualPinsAtZoom) ||
    individualPinsAtZoom < 1 ||
    individualPinsAtZoom > 20
  ) {
    throw new RangeError(
      "individualPinsAtZoom must be an integer from 1 through 20.",
    );
  }

  const bounds = options.bounds;
  if (bounds !== undefined && bounds !== null) {
    if (typeof bounds !== "object") {
      throw new TypeError("bounds must be an object, null, or omitted.");
    }
    const values = [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng];
    if (!values.every((value) => Number.isFinite(value))) {
      throw new RangeError("bounds must contain four finite coordinates.");
    }
    if (
      bounds.minLat < -90 ||
      bounds.maxLat > 90 ||
      bounds.minLat > bounds.maxLat
    ) {
      throw new RangeError(
        "bounds latitude values must satisfy -90 <= minLat <= maxLat <= 90.",
      );
    }
    if (
      bounds.minLng < -180 ||
      bounds.minLng > 180 ||
      bounds.maxLng < -180 ||
      bounds.maxLng > 180
    ) {
      throw new RangeError("bounds longitude values must be in [-180, 180].");
    }
  }

  return { zoom: options.zoom, radiusPx, individualPinsAtZoom, bounds };
}

function resolveCoordinates(
  venue: SpatialVenueInput,
): { coordinates: ResolvedCoordinates } | { reason: ExcludedVenueReason } {
  const hasLongPair =
    venue.latitude !== undefined || venue.longitude !== undefined;
  const hasShortPair = venue.lat !== undefined || venue.lng !== undefined;
  const longPairComplete =
    typeof venue.latitude === "number" && typeof venue.longitude === "number";
  const shortPairComplete =
    typeof venue.lat === "number" && typeof venue.lng === "number";

  if (
    (hasLongPair && !longPairComplete) ||
    (hasShortPair && !shortPairComplete)
  ) {
    return { reason: "invalid_coordinates" };
  }

  if (
    longPairComplete &&
    shortPairComplete &&
    (venue.latitude !== venue.lat || venue.longitude !== venue.lng)
  ) {
    return { reason: "conflicting_coordinates" };
  }

  const latitude = longPairComplete ? venue.latitude : venue.lat;
  const longitude = longPairComplete ? venue.longitude : venue.lng;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !isValidCoordinatePair(latitude, longitude)
  ) {
    return { reason: "invalid_coordinates" };
  }

  return { coordinates: { latitude, longitude } };
}

function isWithinBounds(
  latitude: number,
  longitude: number,
  bounds: GeographicBounds,
): boolean {
  const latitudeMatches =
    latitude >= bounds.minLat && latitude <= bounds.maxLat;
  const longitudeMatches =
    bounds.minLng <= bounds.maxLng
      ? longitude >= bounds.minLng && longitude <= bounds.maxLng
      : longitude >= bounds.minLng || longitude <= bounds.maxLng;
  return latitudeMatches && longitudeMatches;
}

function projectToWorld(
  latitude: number,
  longitude: number,
  zoom: number,
): { x: number; y: number; worldSize: number } {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const clampedLatitude = Math.max(
    -MERCATOR_MAX_LATITUDE,
    Math.min(MERCATOR_MAX_LATITUDE, latitude),
  );
  const latitudeRadians = (clampedLatitude * Math.PI) / 180;
  const sine = Math.sin(latitudeRadians);
  const rawX = ((longitude + 180) / 360) * worldSize;
  const x = ((rawX % worldSize) + worldSize) % worldSize;
  const rawY =
    (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * worldSize;
  const y = Math.max(0, Math.min(worldSize, rawY));
  return { x, y, worldSize };
}

function createNode(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  depth: number,
): QuadTreeNode {
  return { minX, minY, maxX, maxY, depth, points: [], children: null };
}

function childIndex(node: QuadTreeNode, x: number, y: number): number {
  const middleX = (node.minX + node.maxX) / 2;
  const middleY = (node.minY + node.maxY) / 2;
  return (x >= middleX ? 1 : 0) + (y >= middleY ? 2 : 0);
}

function subdivide(node: QuadTreeNode): void {
  const middleX = (node.minX + node.maxX) / 2;
  const middleY = (node.minY + node.maxY) / 2;
  const children = [
    createNode(node.minX, node.minY, middleX, middleY, node.depth + 1),
    createNode(middleX, node.minY, node.maxX, middleY, node.depth + 1),
    createNode(node.minX, middleY, middleX, node.maxY, node.depth + 1),
    createNode(middleX, middleY, node.maxX, node.maxY, node.depth + 1),
  ];
  node.children = children;
}

function insertPoint(node: QuadTreeNode, point: QuadTreePoint): void {
  if (node.children) {
    insertPoint(node.children[childIndex(node, point.x, point.y)], point);
    return;
  }

  node.points.push(point);
  if (
    node.points.length <= QUADTREE_MAX_LEAF_CAPACITY ||
    node.depth >= QUADTREE_MAX_DEPTH
  ) {
    return;
  }

  subdivide(node);
  const previousPoints = node.points;
  node.points = [];
  const children = node.children;
  if (!children) {
    throw new Error("Quadtree subdivision did not create child nodes.");
  }
  for (const previousPoint of previousPoints) {
    insertPoint(
      children[childIndex(node, previousPoint.x, previousPoint.y)],
      previousPoint,
    );
  }
}

function intersects(node: QuadTreeNode, rectangle: QueryRectangle): boolean {
  return !(
    rectangle.maxX < node.minX ||
    rectangle.minX > node.maxX ||
    rectangle.maxY < node.minY ||
    rectangle.minY > node.maxY
  );
}

function queryNode(
  node: QuadTreeNode,
  rectangle: QueryRectangle,
  results: ProjectedLocation[],
): void {
  if (!intersects(node, rectangle)) return;

  if (node.children) {
    for (const child of node.children) {
      queryNode(child, rectangle, results);
    }
    return;
  }

  for (const point of node.points) {
    if (
      point.x >= rectangle.minX &&
      point.x <= rectangle.maxX &&
      point.y >= rectangle.minY &&
      point.y <= rectangle.maxY
    ) {
      results.push(point.location);
    }
  }
}

function wrappedQueryRectangles(
  x: number,
  y: number,
  radiusPx: number,
  worldSize: number,
): QueryRectangle[] {
  const minY = Math.max(0, y - radiusPx);
  const maxY = Math.min(worldSize, y + radiusPx);
  if (radiusPx * 2 >= worldSize) {
    return [{ minX: 0, minY, maxX: worldSize, maxY }];
  }
  if (x - radiusPx < 0) {
    return [
      { minX: 0, minY, maxX: x + radiusPx, maxY },
      { minX: worldSize + x - radiusPx, minY, maxX: worldSize, maxY },
    ];
  }
  if (x + radiusPx > worldSize) {
    return [
      { minX: x - radiusPx, minY, maxX: worldSize, maxY },
      { minX: 0, minY, maxX: x + radiusPx - worldSize, maxY },
    ];
  }
  return [{ minX: x - radiusPx, minY, maxX: x + radiusPx, maxY }];
}

function createUnionFind(size: number): {
  find: (value: number) => number;
  union: (left: number, right: number) => void;
} {
  const parent = Array.from({ length: size }, (_, index) => index);
  const componentSize = Array.from({ length: size }, () => 1);

  function find(value: number): number {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  }

  function union(left: number, right: number): void {
    let leftRoot = find(left);
    let rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (
      componentSize[leftRoot] < componentSize[rightRoot] ||
      (componentSize[leftRoot] === componentSize[rightRoot] &&
        leftRoot > rightRoot)
    ) {
      [leftRoot, rightRoot] = [rightRoot, leftRoot];
    }
    parent[rightRoot] = leftRoot;
    componentSize[leftRoot] += componentSize[rightRoot];
  }

  return { find, union };
}

function wrappedPixelDistance(
  left: ProjectedLocation,
  right: ProjectedLocation,
  worldSize: number,
): number {
  const directXDistance = Math.abs(left.x - right.x);
  const xDistance = Math.min(directXDistance, worldSize - directXDistance);
  return Math.hypot(xDistance, left.y - right.y);
}

function clusterLocations(
  venues: PreparedVenue[],
  radiusPx: number,
  worldSize: number,
  union: (left: number, right: number) => void,
): number {
  const byPosition = new Map<string, ProjectedLocation>();
  for (const venue of venues) {
    const key = `${venue.x},${venue.y}`;
    const existing = byPosition.get(key);
    if (existing) {
      existing.members.push(venue);
    } else {
      byPosition.set(key, {
        x: venue.x,
        y: venue.y,
        order: -1,
        members: [venue],
      });
    }
  }

  const locations = [...byPosition.values()].sort((left, right) =>
    compareIds(left.members[0].id, right.members[0].id),
  );
  locations.forEach((location, index) => {
    location.order = index;
    const firstIndex = location.members[0].index;
    for (
      let memberIndex = 1;
      memberIndex < location.members.length;
      memberIndex++
    ) {
      union(firstIndex, location.members[memberIndex].index);
    }
  });

  const root = createNode(0, 0, worldSize, worldSize, 0);
  let distanceComparisons = 0;

  for (const location of locations) {
    const candidates = new Map<number, ProjectedLocation>();
    for (const rectangle of wrappedQueryRectangles(
      location.x,
      location.y,
      radiusPx,
      worldSize,
    )) {
      const matches: ProjectedLocation[] = [];
      queryNode(root, rectangle, matches);
      for (const match of matches) candidates.set(match.order, match);
    }

    const orderedCandidates = [...candidates.values()].sort((left, right) =>
      compareIds(left.members[0].id, right.members[0].id),
    );
    for (const candidate of orderedCandidates) {
      distanceComparisons++;
      if (wrappedPixelDistance(location, candidate, worldSize) <= radiusPx) {
        union(location.members[0].index, candidate.members[0].index);
      }
    }

    insertPoint(root, { x: location.x, y: location.y, location });
  }

  return distanceComparisons;
}

function normalizeLongitude(longitude: number): number {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function sphericalCentroid(venues: readonly PreparedVenue[]): {
  latitude: number;
  longitude: number;
} {
  if (venues.length === 0) {
    throw new Error("Cannot calculate a centroid for an empty cluster.");
  }

  let x = 0;
  let y = 0;
  let z = 0;
  for (const venue of venues) {
    const latitudeRadians = (venue.latitude * Math.PI) / 180;
    const longitudeRadians = (venue.longitude * Math.PI) / 180;
    const latitudeCosine = Math.cos(latitudeRadians);
    x += latitudeCosine * Math.cos(longitudeRadians);
    y += latitudeCosine * Math.sin(longitudeRadians);
    z += Math.sin(latitudeRadians);
  }

  const horizontalMagnitude = Math.hypot(x, y);
  const magnitude = Math.hypot(horizontalMagnitude, z);
  const fallback = venues[0];
  if (magnitude <= CENTROID_EPSILON * venues.length) {
    return {
      latitude: fallback.latitude,
      longitude: normalizeLongitude(fallback.longitude),
    };
  }

  const latitude = (Math.atan2(z, horizontalMagnitude) * 180) / Math.PI;
  const longitude =
    horizontalMagnitude <= CENTROID_EPSILON * venues.length
      ? normalizeLongitude(fallback.longitude)
      : normalizeLongitude((Math.atan2(y, x) * 180) / Math.PI);
  return { latitude, longitude };
}

function addSafeInteger(total: number, value: number): number {
  const next = total + value;
  if (!Number.isSafeInteger(next)) {
    throw new RangeError(
      "Availability aggregate exceeds safe integer precision.",
    );
  }
  return next;
}

function aggregateAvailability(
  venues: readonly PreparedVenue[],
): VenueAvailabilityAggregate {
  let currentOccupancy = 0;
  let maxCapacity = 0;
  let pairedOccupancy = 0;
  let pairedCapacity = 0;
  let availableCapacity = 0;
  let currentOccupancyVenueCount = 0;
  let maxCapacityVenueCount = 0;
  let pairedAvailabilityVenueCount = 0;

  for (const { input } of venues) {
    const occupancy = input.currentOccupancy;
    const capacity = input.maxCapacity;
    const validOccupancy =
      typeof occupancy === "number" &&
      Number.isSafeInteger(occupancy) &&
      occupancy >= 0;
    const validCapacity =
      typeof capacity === "number" &&
      Number.isSafeInteger(capacity) &&
      capacity >= 0;

    if (validOccupancy) {
      currentOccupancy = addSafeInteger(currentOccupancy, occupancy);
      currentOccupancyVenueCount++;
    }
    if (validCapacity) {
      maxCapacity = addSafeInteger(maxCapacity, capacity);
      maxCapacityVenueCount++;
    }
    if (validOccupancy && validCapacity && occupancy <= capacity) {
      pairedOccupancy = addSafeInteger(pairedOccupancy, occupancy);
      pairedCapacity = addSafeInteger(pairedCapacity, capacity);
      availableCapacity = addSafeInteger(
        availableCapacity,
        capacity - occupancy,
      );
      pairedAvailabilityVenueCount++;
    }
  }

  return {
    currentOccupancy: currentOccupancyVenueCount > 0 ? currentOccupancy : null,
    maxCapacity: maxCapacityVenueCount > 0 ? maxCapacity : null,
    availableCapacity:
      pairedAvailabilityVenueCount > 0 ? availableCapacity : null,
    occupancyRatio:
      pairedCapacity > 0 ? pairedOccupancy / pairedCapacity : null,
    currentOccupancyVenueCount,
    maxCapacityVenueCount,
    pairedAvailabilityVenueCount,
  };
}

function aggregateCluster(
  venues: PreparedVenue[],
  zoom: number,
): SpatialVenueCluster {
  venues.sort((left, right) => compareIds(left.id, right.id));
  const memberVenueIds = venues.map((venue) => venue.id);
  const centroid = sphericalCentroid(venues);

  let wifiMean = 0;
  let wifiCount = 0;
  let minimumNoiseLevel: NoiseCategory | null = null;
  let minimumNoiseDecibels: number | null = null;

  for (const { input } of venues) {
    const wifiSpeed = input.wifiSpeed;
    if (
      typeof wifiSpeed === "number" &&
      Number.isFinite(wifiSpeed) &&
      wifiSpeed >= 0
    ) {
      wifiCount++;
      wifiMean += (wifiSpeed - wifiMean) / wifiCount;
    }

    const noiseLevel = input.noiseLevel;
    if (
      noiseLevel === "quiet" ||
      noiseLevel === "moderate" ||
      noiseLevel === "loud"
    ) {
      if (
        minimumNoiseLevel === null ||
        NOISE_ORDER[noiseLevel] < NOISE_ORDER[minimumNoiseLevel]
      ) {
        minimumNoiseLevel = noiseLevel;
      }
    }

    const avgDecibels = input.avgDecibels;
    if (
      typeof avgDecibels === "number" &&
      Number.isFinite(avgDecibels) &&
      avgDecibels >= 20 &&
      avgDecibels <= 130 &&
      (minimumNoiseDecibels === null || avgDecibels < minimumNoiseDecibels)
    ) {
      minimumNoiseDecibels = avgDecibels;
    }
  }

  return {
    id: `cluster:${zoom}:${JSON.stringify(memberVenueIds)}`,
    venueCount: venues.length,
    centroidLatitude: centroid.latitude,
    centroidLongitude: centroid.longitude,
    averageWifiSpeed: wifiCount > 0 ? wifiMean : null,
    minimumNoiseLevel,
    minimumNoiseDecibels,
    availability: aggregateAvailability(venues),
    zoomLevel: zoom,
    memberVenueIds,
  };
}

/**
 * Clusters valid venues by connected proximity in projected Web Mercator
 * pixels. The quadtree narrows candidate comparisons; distances are then
 * checked exactly in the projection's pixel plane. Longitude wraps at the
 * antimeridian. Invalid-coordinate and out-of-bounds venues are reported in
 * `excludedVenues`; duplicate or malformed IDs throw instead of being lost.
 */
export function clusterSpatialVenues(
  venues: readonly SpatialVenueInput[],
  options: SpatialVenueClusterOptions,
): SpatialVenueClusteringResult {
  const validatedOptions = validateOptions(options);
  if (!Array.isArray(venues)) {
    throw new TypeError("venues must be an array.");
  }

  const sortedInputs = [...venues].sort((left, right) => {
    if (!left || typeof left !== "object") return -1;
    if (!right || typeof right !== "object") return 1;
    return compareIds(left.id, right.id);
  });
  const seenIds = new Set<string>();
  const excludedVenues: ExcludedVenue[] = [];
  const preparedVenues: PreparedVenue[] = [];

  for (const input of sortedInputs) {
    if (!input || typeof input !== "object") {
      throw new TypeError("Each venue must be an object.");
    }
    if (typeof input.id !== "string" || input.id.trim().length === 0) {
      throw new TypeError("Each venue must have a non-empty string id.");
    }
    if (seenIds.has(input.id)) {
      throw new Error(`Duplicate venue id "${input.id}" is not allowed.`);
    }
    seenIds.add(input.id);

    const resolved = resolveCoordinates(input);
    if ("reason" in resolved) {
      excludedVenues.push({ venueId: input.id, reason: resolved.reason });
      continue;
    }

    const { latitude, longitude } = resolved.coordinates;
    if (validatedOptions.bounds === null) {
      excludedVenues.push({ venueId: input.id, reason: "empty_bounds" });
      continue;
    }
    if (
      validatedOptions.bounds !== undefined &&
      !isWithinBounds(latitude, longitude, validatedOptions.bounds)
    ) {
      excludedVenues.push({ venueId: input.id, reason: "outside_bounds" });
      continue;
    }

    const projected = projectToWorld(
      latitude,
      longitude,
      validatedOptions.zoom,
    );
    preparedVenues.push({
      input,
      id: input.id,
      latitude,
      longitude,
      x: projected.x,
      y: projected.y,
      index: preparedVenues.length,
    });
  }

  let distanceComparisons = 0;
  const unionFind = createUnionFind(preparedVenues.length);
  if (validatedOptions.zoom < validatedOptions.individualPinsAtZoom) {
    const worldSize = TILE_SIZE * 2 ** validatedOptions.zoom;
    distanceComparisons = clusterLocations(
      preparedVenues,
      validatedOptions.radiusPx,
      worldSize,
      unionFind.union,
    );
  }

  const components = new Map<number, PreparedVenue[]>();
  for (const venue of preparedVenues) {
    const root = unionFind.find(venue.index);
    const component = components.get(root);
    if (component) component.push(venue);
    else components.set(root, [venue]);
  }

  const clusters = [...components.values()]
    .map((component) => aggregateCluster(component, validatedOptions.zoom))
    .sort((left, right) => compareIds(left.id, right.id));

  excludedVenues.sort((left, right) => compareIds(left.venueId, right.venueId));
  return { clusters, excludedVenues, distanceComparisons };
}

/**
 * Converts a ground-distance radius to approximate local ground meters per
 * Web Mercator pixel. Ground resolution scales with cos(latitude), so the
 * same pixel radius covers less ground near the poles. Clustering itself is
 * performed in projected pixels, not with this approximation.
 */
export function webMercatorMetersPerPixel(
  latitude: number,
  zoom: number,
): number {
  if (!isValidCoordinatePair(latitude, 0)) {
    throw new RangeError("latitude must be a finite value in [-90, 90].");
  }
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 20) {
    throw new RangeError("zoom must be an integer from 1 through 20.");
  }
  const clampedLatitude = Math.max(
    -MERCATOR_MAX_LATITUDE,
    Math.min(MERCATOR_MAX_LATITUDE, latitude),
  );
  return (
    (2 *
      Math.PI *
      EARTH_MEAN_RADIUS_METERS *
      Math.cos((clampedLatitude * Math.PI) / 180)) /
    (TILE_SIZE * 2 ** zoom)
  );
}

// ---------------------------------------------------------------------------
// Hexagonal Spatial Clustering, H3 Resolution Helpers & Nomad Venue Ranking
// ---------------------------------------------------------------------------

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
  noiseLevelDb?: number;
  quietScore?: number;
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

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export type H3Resolution = 7 | 8 | 9;

export const H3_RESOLUTIONS = {
  RES_7: 7,
  RES_8: 8,
  RES_9: 9,
} as const;

export const H3_RESOLUTION_EDGE_KM: Record<number, number> = {
  6: 3.23,
  7: 1.22,
  8: 0.461,
  9: 0.174,
  10: 0.066,
};

export const H3_RESOLUTION_AREA_KM2: Record<number, number> = {
  6: 36.13,
  7: 5.16,
  8: 0.737,
  9: 0.105,
  10: 0.015,
};

export interface HexVenueCluster {
  cellId: string;
  resolution: number;
  q: number;
  r: number;
  center: GeoCoordinate;
  centroid: GeoCoordinate;
  boundary: GeoCoordinate[];
  polygonGeoJson: [number, number][];
  venues: VenueCandidate[];
  venueCount: number;
  density: number;
  avgWifiMbps: number;
  avgQuietScore: number;
  totalAvailableSeats: number;
}

export interface HexGeoJsonFeature {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Polygon';
    coordinates: [number, number][][];
  };
  properties: {
    cellId: string;
    resolution: number;
    venueCount: number;
    density: number;
    avgWifiMbps: number;
    avgQuietScore: number;
    totalAvailableSeats: number;
    centroidLat: number;
    centroidLng: number;
  };
}

export interface HexGeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: HexGeoJsonFeature[];
}

export function zoomToH3Resolution(zoom: number): number {
  if (zoom <= 12) return 7;
  if (zoom <= 14) return 8;
  return 9;
}

export function isCoordinateInBoundingBox(
  coord: GeoCoordinate,
  bbox: BoundingBox
): boolean {
  if (!isValidCoordinate(coord)) return false;
  if (coord.lat < bbox.minLat || coord.lat > bbox.maxLat) return false;

  if (bbox.minLng > bbox.maxLng) {
    return coord.lng >= bbox.minLng || coord.lng <= bbox.maxLng;
  }
  return coord.lng >= bbox.minLng && coord.lng <= bbox.maxLng;
}

export function filterVenuesByBoundingBox(
  venues: readonly VenueCandidate[],
  bbox: BoundingBox
): VenueCandidate[] {
  return venues.filter((v) => isCoordinateInBoundingBox(v, bbox));
}

export function axialHexToCenter(
  cell: AxialHexCell,
  cellRadiusKm: number
): GeoCoordinate {
  const kmPerDegLat = 111.32;
  const safeRadius =
    typeof cellRadiusKm === 'number' && Number.isFinite(cellRadiusKm) && cellRadiusKm > 0
      ? cellRadiusKm
      : 0.461;

  const xKm = 1.5 * cell.q * safeRadius;
  const yKm = (SQRT3 / 2) * (2 * cell.r + cell.q) * safeRadius;

  const lat = Math.max(-90, Math.min(90, yKm / kmPerDegLat));
  const cosLat = Math.max(0.1, Math.cos(toRadians(lat)));
  const lng = Math.max(-180, Math.min(180, xKm / (kmPerDegLat * cosLat)));

  return {
    lat: Math.round(lat * 1_000_000) / 1_000_000,
    lng: Math.round(lng * 1_000_000) / 1_000_000,
  };
}

export function getHexagonBoundary(
  center: GeoCoordinate,
  radiusKm: number
): GeoCoordinate[] {
  const kmPerDegLat = 111.32;
  const cosLat = Math.max(0.1, Math.cos(toRadians(center.lat)));
  const kmPerDegLng = kmPerDegLat * cosLat;
  const vertices: GeoCoordinate[] = [];

  for (let i = 0; i < 6; i++) {
    const angleRad = (i * Math.PI) / 3;
    const dxKm = radiusKm * Math.cos(angleRad);
    const dyKm = radiusKm * Math.sin(angleRad);

    const lat = Math.max(-90, Math.min(90, center.lat + dyKm / kmPerDegLat));
    const lng = Math.max(-180, Math.min(180, center.lng + dxKm / kmPerDegLng));

    vertices.push({
      lat: Math.round(lat * 1_000_000) / 1_000_000,
      lng: Math.round(lng * 1_000_000) / 1_000_000,
    });
  }

  return vertices;
}

export function getHexagonGeoJsonPolygon(
  center: GeoCoordinate,
  radiusKm: number
): [number, number][] {
  const boundary = getHexagonBoundary(center, radiusKm);
  const ring: [number, number][] = boundary.map((pt) => [pt.lng, pt.lat]);
  if (boundary.length > 0) {
    ring.push([boundary[0].lng, boundary[0].lat]);
  }
  return ring;
}

export function extractQuietScore(venue: VenueCandidate): number | undefined {
  if (typeof venue.quietScore === 'number' && Number.isFinite(venue.quietScore)) {
    return Math.max(0, Math.min(100, venue.quietScore));
  }
  if (typeof venue.noiseLevelDb === 'number' && Number.isFinite(venue.noiseLevelDb)) {
    return Math.max(0, Math.min(100, Math.round(100 - (venue.noiseLevelDb - 30) * 1.5)));
  }
  return undefined;
}

export function clusterVenuesByH3Resolution(
  venues: readonly VenueCandidate[],
  options: {
    resolution?: number;
    zoom?: number;
    bbox?: BoundingBox;
  } = {}
): HexVenueCluster[] {
  const resolution =
    options.resolution ??
    (typeof options.zoom === 'number' ? zoomToH3Resolution(options.zoom) : 8);

  const radiusKm = H3_RESOLUTION_EDGE_KM[resolution] ?? 0.461;
  const areaKm2 = H3_RESOLUTION_AREA_KM2[resolution] ?? 0.737;

  const filteredVenues = options.bbox
    ? filterVenuesByBoundingBox(venues, options.bbox)
    : venues;

  const buckets = new Map<string, { cell: AxialHexCell; items: VenueCandidate[] }>();

  for (let i = 0; i < filteredVenues.length; i++) {
    const venue = filteredVenues[i];
    if (!isValidCoordinate(venue)) continue;

    const cell = latLngToAxialHex(venue, radiusKm);
    const key = `${cell.q}:${cell.r}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.items.push(venue);
    } else {
      buckets.set(key, { cell, items: [venue] });
    }
  }

  const clusters: HexVenueCluster[] = [];

  for (const [key, { cell, items }] of buckets.entries()) {
    let latSum = 0;
    let lngSum = 0;
    let totalAvailableSeats = 0;
    let wifiSum = 0;
    let wifiCount = 0;
    let quietSum = 0;
    let quietCount = 0;

    for (let i = 0; i < items.length; i++) {
      const v = items[i];
      latSum += v.lat;
      lngSum += v.lng;
      totalAvailableSeats += Math.max(0, v.availableSeats || 0);

      if (typeof v.wifiMbps === 'number' && Number.isFinite(v.wifiMbps) && v.wifiMbps >= 0) {
        wifiSum += v.wifiMbps;
        wifiCount++;
      }

      const qScore = extractQuietScore(v);
      if (qScore !== undefined) {
        quietSum += qScore;
        quietCount++;
      }
    }

    const itemCount = items.length;
    const centroid: GeoCoordinate = {
      lat: Math.round((latSum / itemCount) * 1_000_000) / 1_000_000,
      lng: Math.round((lngSum / itemCount) * 1_000_000) / 1_000_000,
    };

    const center = axialHexToCenter(cell, radiusKm);
    const boundary = getHexagonBoundary(center, radiusKm);
    const polygonGeoJson = getHexagonGeoJsonPolygon(center, radiusKm);

    const avgWifiMbps =
      wifiCount > 0 ? Math.round((wifiSum / wifiCount) * 10) / 10 : 0;
    const avgQuietScore =
      quietCount > 0 ? Math.round((quietSum / quietCount) * 10) / 10 : 70;
    const density = Math.round((itemCount / areaKm2) * 10) / 10;

    clusters.push({
      cellId: `h3:res${resolution}:${key}`,
      resolution,
      q: cell.q,
      r: cell.r,
      center,
      centroid,
      boundary,
      polygonGeoJson,
      venues: items,
      venueCount: itemCount,
      density,
      avgWifiMbps,
      avgQuietScore,
      totalAvailableSeats,
    });
  }

  return clusters.sort((a, b) => b.venueCount - a.venueCount);
}

export function hexClustersToGeoJson(
  clusters: readonly HexVenueCluster[]
): HexGeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: clusters.map((cluster) => ({
      type: 'Feature',
      id: cluster.cellId,
      geometry: {
        type: 'Polygon',
        coordinates: [cluster.polygonGeoJson],
      },
      properties: {
        cellId: cluster.cellId,
        resolution: cluster.resolution,
        venueCount: cluster.venueCount,
        density: cluster.density,
        avgWifiMbps: cluster.avgWifiMbps,
        avgQuietScore: cluster.avgQuietScore,
        totalAvailableSeats: cluster.totalAvailableSeats,
        centroidLat: cluster.centroid.lat,
        centroidLng: cluster.centroid.lng,
      },
    })),
  };
}
