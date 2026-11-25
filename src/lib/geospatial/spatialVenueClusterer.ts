import { isValidCoordinate } from "@/lib/utils";
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
    !isValidCoordinate(latitude, longitude)
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
  if (!isValidCoordinate(latitude, 0)) {
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
