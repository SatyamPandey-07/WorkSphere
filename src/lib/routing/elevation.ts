/**
 * elevation.ts
 *
 * Elevation analysis, incline calculations, and wheelchair-accessible route profiling utilities.
 * Implements:
 * - Distance calculation between geographic coordinates (Haversine formula in meters).
 * - Safe extraction and alignment of route coordinates with elevation samples.
 * - Cumulative positive elevation gain (ascent), descent, min, and max elevation (in meters).
 * - Segment-by-segment incline grade calculation: grade = (elevation diff / horizontal distance) * 100.
 * - Detection of steep inclines (> 8.0% warning threshold) and wheelchair-inaccessible inclines (> 8.33% threshold).
 * - Route accessibility assessment incorporating elevation profile and stair metadata.
 * - Testable elevation service interface and mockable provider for elevation lookups.
 *
 * Issue #9757: feat(routing): add elevation gain and wheelchair-accessible route profile summary on map
 */

export interface Coordinate {
  lat: number;
  lng: number;
}

export type CoordinateTuple = [number, number] | [number, number, number];

export type ElevationInputCoordinate =
  | Coordinate
  | CoordinateTuple
  | { latitude: number; longitude: number; elevation?: number | null };

/**
 * An individual point along an evaluated route's elevation profile.
 */
export interface ElevationProfilePoint {
  /** Sequential index along the route profile */
  index: number;
  /** Latitude in degrees */
  lat: number;
  /** Longitude in degrees */
  lng: number;
  /** Cumulative horizontal ground distance from the route origin in meters */
  distanceFromStartMeters: number;
  /** Horizontal segment distance from previous point in meters */
  segmentDistanceMeters: number;
  /** Elevation in meters at this coordinate */
  elevationMeters: number;
  /** Segment incline percentage from previous point: (deltaElevation / segmentDistance) * 100 */
  gradePercent: number;
  /** Whether this segment is uphill (gradePercent > 0) */
  isUphill: boolean;
  /** Whether uphill incline exceeds the general steepness warning threshold (> 8.0%) */
  isSteepWarning: boolean;
  /** Whether uphill incline exceeds the wheelchair accessibility threshold (> 8.33%) */
  isWheelchairInaccessibleSlope: boolean;
}

/**
 * Detailed incline summary across all route segments.
 */
export interface InclineSummary {
  /** Maximum uphill incline percentage encountered on the route (>= 0) */
  maxUphillGradePercent: number;
  /** Maximum downhill incline percentage encountered on the route (<= 0) */
  maxDownhillGradePercent: number;
  /** Average uphill grade percentage */
  avgUphillGradePercent: number;
  /** Whether any segment exceeds the 8.0% general steepness warning threshold */
  exceedsSteepWarningThreshold: boolean;
  /** Whether any segment exceeds the 8.33% wheelchair incline threshold */
  exceedsWheelchairInclineThreshold: boolean;
  /** Total horizontal distance of steep segments (> 8.0%) in meters */
  steepSegmentsDistanceMeters: number;
  /** Total horizontal distance of wheelchair-inaccessible segments (> 8.33%) in meters */
  wheelchairInaccessibleDistanceMeters: number;
  /** Count of segments exceeding the 8.0% steepness threshold */
  steepSegmentCount: number;
  /** Count of segments exceeding the 8.33% wheelchair threshold */
  wheelchairInaccessibleSegmentCount: number;
}

/**
 * Route accessibility categorization.
 * Note: A route is never categorized as fully "accessible" purely from low inclines unless
 * stair and surface metadata confirm absence of barriers.
 */
export type AccessibilityStatus = 'accessible' | 'warning' | 'inaccessible' | 'unknown';

export type StairStatus = 'no_stairs' | 'has_stairs' | 'unknown';

export interface RouteAccessibilityAssessment {
  /** Whether elevation profile data was available and evaluated */
  isElevationAvailable: boolean;
  /** Overall accessibility status based on slope, stairs, and data completeness */
  status: AccessibilityStatus;
  /** Human-readable explanation of the assessment */
  summary: string;
  /** Detailed warnings if any barrier was identified */
  warnings: string[];
  /** Stair presence evaluation */
  stairStatus: StairStatus;
  /** Number of stair steps or flight occurrences detected if reported */
  stairCount?: number;
  /** Total positive ascent in meters */
  totalAscentMeters: number;
  /** Total negative descent in meters */
  totalDescentMeters: number;
  /** Minimum elevation along route in meters */
  minElevationMeters: number | null;
  /** Maximum elevation along route in meters */
  maxElevationMeters: number | null;
  /** Maximum uphill grade encountered */
  maxUphillGradePercent: number;
  /** Incline evaluation summary */
  incline: InclineSummary;
}

/**
 * Comprehensive route profile evaluation output.
 */
export interface RouteProfileEvaluation {
  hasElevationData: boolean;
  totalDistanceMeters: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  minElevationMeters: number | null;
  maxElevationMeters: number | null;
  profilePoints: ElevationProfilePoint[];
  incline: InclineSummary;
  accessibility: RouteAccessibilityAssessment;
}

/**
 * Metadata provided alongside route coordinates to refine accessibility evaluation.
 */
export interface RouteEvaluationMetadata {
  /**
   * Known stair presence on route:
   * - true: route explicitly contains stairs
   * - false: route is verified to have zero stairs
   * - undefined / null: stair status is unknown
   */
  hasStairs?: boolean | null;
  /** Number of stairs or stair segments if known */
  stairCount?: number | null;
  /** Surface suitability or type (e.g., 'paved', 'gravel', 'steps') */
  surfaceType?: string | null;
  /** Curb ramp availability status */
  hasCurbRamps?: boolean | null;
}

/**
 * Thresholds documented for pedestrian and wheelchair accessibility.
 * - 8.00%: Standard steepness warning threshold for pedestrians and cyclists.
 * - 8.33%: Standard maximum slope for wheelchair accessibility (1:12 ramp gradient).
 */
export const ELEVATION_THRESHOLDS = {
  /** General steepness warning threshold in percent (8%) */
  STEEP_WARNING_PERCENT: 8.0,
  /** Wheelchair accessibility threshold in percent (8.33%, 1:12 slope) */
  WHEELCHAIR_MAX_INCLINE_PERCENT: 8.33,
  /** Minimum horizontal segment distance in meters to calculate meaningful slope */
  MIN_SEGMENT_DISTANCE_METERS: 0.5,
  /** Earth mean radius in meters */
  EARTH_RADIUS_METERS: 6_371_000,
} as const;

/**
 * Calculates the great-circle distance between two geographic coordinates in meters
 * using the Haversine formula.
 */
export function calculateHaversineDistanceMeters(
  coord1: Coordinate,
  coord2: Coordinate
): number {
  if (
    !Number.isFinite(coord1.lat) ||
    !Number.isFinite(coord1.lng) ||
    !Number.isFinite(coord2.lat) ||
    !Number.isFinite(coord2.lng)
  ) {
    return 0;
  }

  // Exact same point
  if (coord1.lat === coord2.lat && coord1.lng === coord2.lng) {
    return 0;
  }

  const radLat1 = (coord1.lat * Math.PI) / 180;
  const radLat2 = (coord2.lat * Math.PI) / 180;
  const deltaLat = ((coord2.lat - coord1.lat) * Math.PI) / 180;
  const deltaLng = ((coord2.lng - coord1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(radLat1) *
      Math.cos(radLat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(Math.max(0, 1 - a)));
  return ELEVATION_THRESHOLDS.EARTH_RADIUS_METERS * c;
}

/**
 * Normalizes varied coordinate representations into standard { lat, lng } format.
 * Returns null if the coordinate is invalid or non-finite.
 */
export function normalizeCoordinate(input: ElevationInputCoordinate): Coordinate | null {
  if (!input) return null;

  if (Array.isArray(input)) {
    // GeoJSON standard: [longitude, latitude, elevation?]
    const [first, second] = input;
    if (typeof first === 'number' && typeof second === 'number') {
      const lng = first;
      const lat = second;
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }
    return null;
  }

  if (typeof input === 'object') {
    const lat = 'lat' in input ? (input as any).lat : (input as any).latitude;
    const lng = 'lng' in input ? (input as any).lng : (input as any).longitude;
    if (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      return { lat, lng };
    }
  }

  return null;
}

/**
 * Extracts elevation in meters from a coordinate representation or explicit sample.
 * Returns null if missing or not a finite number (never silently coerces to 0).
 */
export function extractElevationSample(
  coord: ElevationInputCoordinate,
  sample?: number | null
): number | null {
  if (typeof sample === 'number' && Number.isFinite(sample)) {
    return sample;
  }

  if (Array.isArray(coord) && coord.length >= 3) {
    const ele = coord[2];
    if (typeof ele === 'number' && Number.isFinite(ele)) {
      return ele;
    }
  }

  if (typeof coord === 'object' && coord !== null && !Array.isArray(coord)) {
    const candidate =
      (coord as any).elevation ??
      (coord as any).elevationMeters ??
      (coord as any).ele ??
      (coord as any).alt;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Calculates grade incline percentage between two points given their elevation delta and ground distance.
 * grade = (elevation difference / horizontal ground distance) * 100
 *
 * Rules:
 * - Uses horizontal ground distance (not elevation-adjusted hypotenuse).
 * - If horizontal distance is below MIN_SEGMENT_DISTANCE_METERS or <= 0, returns 0 to prevent division by zero.
 * - Preserves sign: positive for uphill, negative for downhill.
 */
export function calculateSegmentGrade(
  elevationDiffMeters: number,
  horizontalDistanceMeters: number
): number {
  if (
    !Number.isFinite(elevationDiffMeters) ||
    !Number.isFinite(horizontalDistanceMeters) ||
    horizontalDistanceMeters < ELEVATION_THRESHOLDS.MIN_SEGMENT_DISTANCE_METERS
  ) {
    return 0;
  }

  const rawGrade = (elevationDiffMeters / horizontalDistanceMeters) * 100;
  // Round to 2 decimal places to avoid floating point precision artifacts
  return Math.round(rawGrade * 100) / 100;
}

/**
 * Pure calculation engine to process coordinates and elevation samples into a comprehensive
 * route profile and accessibility assessment.
 */
export function evaluateRouteElevationProfile(
  coordinates: ElevationInputCoordinate[],
  elevationSamples?: (number | null | undefined)[],
  metadata?: RouteEvaluationMetadata
): RouteProfileEvaluation {
  const normalizedCoords: { coord: Coordinate; originalIndex: number }[] = [];

  coordinates.forEach((c, idx) => {
    const norm = normalizeCoordinate(c);
    if (norm) {
      normalizedCoords.push({ coord: norm, originalIndex: idx });
    }
  });

  // If insufficient valid coordinates
  if (normalizedCoords.length < 2) {
    return createEmptyEvaluation(metadata);
  }

  // Extract aligned elevation samples
  const elevations: (number | null)[] = normalizedCoords.map((item) => {
    const sample = elevationSamples ? elevationSamples[item.originalIndex] : undefined;
    return extractElevationSample(coordinates[item.originalIndex], sample);
  });

  // Verify whether we have valid elevation data (at least 2 valid samples)
  const validElevationsCount = elevations.filter((e): e is number => typeof e === 'number' && Number.isFinite(e)).length;
  const hasElevationData = validElevationsCount >= 2 && validElevationsCount === elevations.length;

  // If elevation samples are missing, incomplete, or invalid, report with elevation marked unavailable
  if (!hasElevationData) {
    let totalDist = 0;
    for (let i = 1; i < normalizedCoords.length; i++) {
      totalDist += calculateHaversineDistanceMeters(
        normalizedCoords[i - 1].coord,
        normalizedCoords[i].coord
      );
    }

    return {
      hasElevationData: false,
      totalDistanceMeters: Math.round(totalDist * 10) / 10,
      totalAscentMeters: 0,
      totalDescentMeters: 0,
      minElevationMeters: null,
      maxElevationMeters: null,
      profilePoints: [],
      incline: createEmptyInclineSummary(),
      accessibility: assessAccessibility({
        hasElevationData: false,
        totalAscentMeters: 0,
        totalDescentMeters: 0,
        minElevationMeters: null,
        maxElevationMeters: null,
        incline: createEmptyInclineSummary(),
        metadata,
      }),
    };
  }

  // We have complete, valid elevation data
  const profilePoints: ElevationProfilePoint[] = [];
  let cumulativeDistance = 0;
  let totalAscent = 0;
  let totalDescent = 0;
  let minEle = elevations[0]!;
  let maxEle = elevations[0]!;

  let maxUphillGrade = 0;
  let maxDownhillGrade = 0;
  let sumUphillGrade = 0;
  let uphillCount = 0;
  let steepSegmentsDistance = 0;
  let steepSegmentCount = 0;
  let wheelchairInaccessibleDistance = 0;
  let wheelchairInaccessibleCount = 0;

  // First point
  profilePoints.push({
    index: 0,
    lat: normalizedCoords[0].coord.lat,
    lng: normalizedCoords[0].coord.lng,
    distanceFromStartMeters: 0,
    segmentDistanceMeters: 0,
    elevationMeters: elevations[0]!,
    gradePercent: 0,
    isUphill: false,
    isSteepWarning: false,
    isWheelchairInaccessibleSlope: false,
  });

  for (let i = 1; i < normalizedCoords.length; i++) {
    const prevCoord = normalizedCoords[i - 1].coord;
    const currCoord = normalizedCoords[i].coord;
    const prevElevation = elevations[i - 1]!;
    const currElevation = elevations[i]!;

    const segDist = calculateHaversineDistanceMeters(prevCoord, currCoord);
    cumulativeDistance += segDist;

    const deltaElevation = currElevation - prevElevation;
    if (deltaElevation > 0) {
      totalAscent += deltaElevation;
    } else if (deltaElevation < 0) {
      totalDescent += Math.abs(deltaElevation);
    }

    minEle = Math.min(minEle, currElevation);
    maxEle = Math.max(maxEle, currElevation);

    const grade = calculateSegmentGrade(deltaElevation, segDist);
    const isUphill = grade > 0;
    const isSteepWarning = isUphill && grade > ELEVATION_THRESHOLDS.STEEP_WARNING_PERCENT;
    const isWheelchairInaccessible = isUphill && grade > ELEVATION_THRESHOLDS.WHEELCHAIR_MAX_INCLINE_PERCENT;

    if (isUphill) {
      maxUphillGrade = Math.max(maxUphillGrade, grade);
      sumUphillGrade += grade;
      uphillCount++;
    } else if (grade < 0) {
      maxDownhillGrade = Math.min(maxDownhillGrade, grade);
    }

    if (isSteepWarning) {
      steepSegmentsDistance += segDist;
      steepSegmentCount++;
    }

    if (isWheelchairInaccessible) {
      wheelchairInaccessibleDistance += segDist;
      wheelchairInaccessibleCount++;
    }

    profilePoints.push({
      index: i,
      lat: currCoord.lat,
      lng: currCoord.lng,
      distanceFromStartMeters: Math.round(cumulativeDistance * 10) / 10,
      segmentDistanceMeters: Math.round(segDist * 10) / 10,
      elevationMeters: Math.round(currElevation * 100) / 100,
      gradePercent: grade,
      isUphill,
      isSteepWarning,
      isWheelchairInaccessibleSlope: isWheelchairInaccessible,
    });
  }

  const incline: InclineSummary = {
    maxUphillGradePercent: Math.round(maxUphillGrade * 100) / 100,
    maxDownhillGradePercent: Math.round(maxDownhillGrade * 100) / 100,
    avgUphillGradePercent: uphillCount > 0 ? Math.round((sumUphillGrade / uphillCount) * 100) / 100 : 0,
    exceedsSteepWarningThreshold: maxUphillGrade > ELEVATION_THRESHOLDS.STEEP_WARNING_PERCENT,
    exceedsWheelchairInclineThreshold: maxUphillGrade > ELEVATION_THRESHOLDS.WHEELCHAIR_MAX_INCLINE_PERCENT,
    steepSegmentsDistanceMeters: Math.round(steepSegmentsDistance * 10) / 10,
    wheelchairInaccessibleDistanceMeters: Math.round(wheelchairInaccessibleDistance * 10) / 10,
    steepSegmentCount,
    wheelchairInaccessibleSegmentCount: wheelchairInaccessibleCount,
  };

  const accessibility = assessAccessibility({
    hasElevationData: true,
    totalAscentMeters: Math.round(totalAscent * 100) / 100,
    totalDescentMeters: Math.round(totalDescent * 100) / 100,
    minElevationMeters: Math.round(minEle * 100) / 100,
    maxElevationMeters: Math.round(maxEle * 100) / 100,
    incline,
    metadata,
  });

  return {
    hasElevationData: true,
    totalDistanceMeters: Math.round(cumulativeDistance * 10) / 10,
    totalAscentMeters: Math.round(totalAscent * 100) / 100,
    totalDescentMeters: Math.round(totalDescent * 100) / 100,
    minElevationMeters: Math.round(minEle * 100) / 100,
    maxElevationMeters: Math.round(maxEle * 100) / 100,
    profilePoints,
    incline,
    accessibility,
  };
}

interface AssessAccessibilityParams {
  hasElevationData: boolean;
  totalAscentMeters: number;
  totalDescentMeters: number;
  minElevationMeters: number | null;
  maxElevationMeters: number | null;
  incline: InclineSummary;
  metadata?: RouteEvaluationMetadata;
}

/**
 * Evaluates route accessibility based on slope thresholds, stair detection, and data completeness.
 *
 * Rules:
 * 1. If elevation data is unavailable -> status is 'unknown'.
 * 2. If metadata indicates stairs are present (hasStairs === true) -> status is 'inaccessible'.
 * 3. If slope exceeds 8.33% -> status is 'inaccessible' (exceeds wheelchair maximum slope).
 * 4. If slope exceeds 8.0% (but <= 8.33%) -> status is 'warning' (steep pedestrian grade).
 * 5. If stair information is unknown (hasStairs is undefined/null) -> status is 'unknown' or 'warning',
 *    NEVER 'accessible' (we cannot claim full wheelchair accessibility without stair metadata).
 * 6. If slope is <= 8.0% AND hasStairs is explicitly false -> status is 'accessible'.
 */
export function assessAccessibility(params: AssessAccessibilityParams): RouteAccessibilityAssessment {
  const { hasElevationData, totalAscentMeters, totalDescentMeters, minElevationMeters, maxElevationMeters, incline, metadata } = params;

  const warnings: string[] = [];

  // 1. Stair Status Evaluation
  let stairStatus: StairStatus = 'unknown';
  let stairCount: number | undefined;

  if (metadata?.hasStairs === true) {
    stairStatus = 'has_stairs';
    stairCount = metadata.stairCount ?? 1;
    warnings.push(`Route includes stairs (${stairCount > 1 ? `${stairCount} steps/flights` : 'stairs detected'}) — not wheelchair accessible.`);
  } else if (metadata?.hasStairs === false) {
    stairStatus = 'no_stairs';
  } else {
    stairStatus = 'unknown';
    warnings.push('Stair and curb-ramp information is unavailable for this pedestrian path.');
  }

  // 2. Elevation Data Availability
  if (!hasElevationData) {
    warnings.push('Elevation data unavailable for route coordinates. Incline could not be evaluated.');
    return {
      isElevationAvailable: false,
      status: 'unknown',
      summary: 'Route accessibility unknown: Missing elevation data and unverified stair status.',
      warnings,
      stairStatus,
      stairCount,
      totalAscentMeters: 0,
      totalDescentMeters: 0,
      minElevationMeters: null,
      maxElevationMeters: null,
      maxUphillGradePercent: 0,
      incline,
    };
  }

  // 3. Slope Warnings
  if (incline.exceedsWheelchairInclineThreshold) {
    warnings.push(
      `Steep incline warning: Max uphill slope is ${incline.maxUphillGradePercent}%, exceeding the 8.33% wheelchair limit over ${incline.wheelchairInaccessibleDistanceMeters}m.`
    );
  } else if (incline.exceedsSteepWarningThreshold) {
    warnings.push(
      `Moderate incline warning: Max uphill slope is ${incline.maxUphillGradePercent}%, exceeding the 8.0% steepness threshold over ${incline.steepSegmentsDistanceMeters}m.`
    );
  }

  // 4. Synthesize Status
  let status: AccessibilityStatus = 'unknown';
  let summary = '';

  if (stairStatus === 'has_stairs' || incline.exceedsWheelchairInclineThreshold) {
    status = 'inaccessible';
    summary = stairStatus === 'has_stairs'
      ? 'Route is not wheelchair-accessible due to stairs.'
      : `Route is not wheelchair-accessible due to steep incline (${incline.maxUphillGradePercent}% max grade).`;
  } else if (incline.exceedsSteepWarningThreshold) {
    status = 'warning';
    summary = `Caution: Steep pedestrian incline (${incline.maxUphillGradePercent}% grade).`;
  } else if (stairStatus === 'unknown') {
    // Slopes are gentle, but stair verification is missing
    status = 'unknown';
    summary = `Incline is gentle (${incline.maxUphillGradePercent}% max), but stair status is unconfirmed.`;
  } else if (stairStatus === 'no_stairs' && !incline.exceedsSteepWarningThreshold) {
    // Both low slope and confirmed stair-free
    status = 'accessible';
    summary = `Accessible route profile: Low incline (${incline.maxUphillGradePercent}% max grade) with step-free access verified.`;
  }

  return {
    isElevationAvailable: true,
    status,
    summary,
    warnings,
    stairStatus,
    stairCount,
    totalAscentMeters,
    totalDescentMeters,
    minElevationMeters,
    maxElevationMeters,
    maxUphillGradePercent: incline.maxUphillGradePercent,
    incline,
  };
}

function createEmptyInclineSummary(): InclineSummary {
  return {
    maxUphillGradePercent: 0,
    maxDownhillGradePercent: 0,
    avgUphillGradePercent: 0,
    exceedsSteepWarningThreshold: false,
    exceedsWheelchairInclineThreshold: false,
    steepSegmentsDistanceMeters: 0,
    wheelchairInaccessibleDistanceMeters: 0,
    steepSegmentCount: 0,
    wheelchairInaccessibleSegmentCount: 0,
  };
}

function createEmptyEvaluation(metadata?: RouteEvaluationMetadata): RouteProfileEvaluation {
  const emptyIncline = createEmptyInclineSummary();
  return {
    hasElevationData: false,
    totalDistanceMeters: 0,
    totalAscentMeters: 0,
    totalDescentMeters: 0,
    minElevationMeters: null,
    maxElevationMeters: null,
    profilePoints: [],
    incline: emptyIncline,
    accessibility: {
      isElevationAvailable: false,
      status: 'unknown',
      summary: 'Insufficient route coordinates to evaluate elevation or accessibility.',
      warnings: ['Insufficient route coordinates.'],
      stairStatus: metadata?.hasStairs === true ? 'has_stairs' : metadata?.hasStairs === false ? 'no_stairs' : 'unknown',
      totalAscentMeters: 0,
      totalDescentMeters: 0,
      minElevationMeters: null,
      maxElevationMeters: null,
      maxUphillGradePercent: 0,
      incline: emptyIncline,
    },
  };
}

/**
 * Pluggable Elevation Service Interface
 */
export interface IElevationProvider {
  /**
   * Fetches elevation samples for an ordered list of coordinates.
   * Returns an array of elevation values in meters corresponding to each input coordinate,
   * or null if the lookup fails or returns incomplete results.
   */
  getElevations(coordinates: Coordinate[]): Promise<(number | null)[]>;
}

/**
 * In-memory or Mock Elevation Provider for testing and offline scenarios.
 */
export class MockElevationProvider implements IElevationProvider {
  constructor(private readonly mockElevations: (number | null)[]) {}

  public async getElevations(coordinates: Coordinate[]): Promise<(number | null)[]> {
    return coordinates.map((_, i) => this.mockElevations[i] ?? null);
  }
}
