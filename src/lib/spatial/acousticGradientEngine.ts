/**
 * acousticGradientEngine.ts
 * Spatial acoustic field decay and Inverse Distance Weighting (IDW) interpolation engine.
 * Computes continuous 2D/3D sound level contours (20dB - 110dB) across workspace floorplans.
 */

export const MIN_ACOUSTIC_DB = 20; // Sensible acoustic floor (20 dB)
export const MAX_ACOUSTIC_DB = 110; // Sensible acoustic ceiling (110 dB)

/**
 * Clamps raw acoustic decibel telemetry inputs between a sensible acoustic floor (20 dB)
 * and ceiling (110 dB) before calculating normalized shader coordinates or color interpolation.
 */
export function clampDecibels(
  db: number,
  floor = MIN_ACOUSTIC_DB,
  ceiling = MAX_ACOUSTIC_DB,
): number {
  if (typeof db !== "number" || !Number.isFinite(db) || Number.isNaN(db))
    return floor;
  return Math.min(ceiling, Math.max(floor, db));
}

/**
 * Normalizes acoustic decibels into a 0.0 - 1.0 range, clamped between acoustic floor (20 dB) and ceiling (110 dB).
 * Used for shader coordinates, color ramp interpolation, and thermal contour mapping.
 */
export function normalizeAcousticDecibels(
  db: number,
  floor = MIN_ACOUSTIC_DB,
  ceiling = MAX_ACOUSTIC_DB,
): number {
  const clamped = clampDecibels(db, floor, ceiling);
  return Number(((clamped - floor) / (ceiling - floor)).toFixed(4));
}

export interface SoundEmitter {
  id: string;
  name: string;
  type:
    | "ESPRESSO_BAR"
    | "ENTRANCE_DOOR"
    | "COLLABORATIVE_TABLE"
    | "PHONE_BOOTH"
    | "HVAC_UNIT";
  x: number; // 0 to 100 percentage of floorplan width
  y: number; // 0 to 100 percentage of floorplan height
  baseDecibels: number;
  isActive: boolean;
}

export interface AcousticGridPoint {
  x: number;
  y: number;
  decibels: number;
  zone:
    "SILENT_FOCUS" | "BALANCED_AMBIENT" | "COLLABORATIVE_BUZZ" | "HIGH_NOISE";
}

export interface DeskSoundRating {
  seatId: string;
  seatNumber: string;
  x: number;
  y: number;
  predictedDecibels: number;
  nearestEmitter: string;
  distanceToEmitterMeters: number;
  callSuitabilityScore: number; // 0 to 100
}

export interface AcousticFieldMap {
  gridWidth: number;
  gridHeight: number;
  grid: number[][]; // 2D matrix of decibel values
  emitters: SoundEmitter[];
  desks: DeskSoundRating[];
}

/**
 * Calculates sound pressure level (SPL) at distance r using inverse square decay with air absorption.
 * Clamps input source and output SPL between 20 dB and 110 dB.
 */
export function calculatePointSPL(
  sourceDb: number,
  distanceUnits: number,
  absorptionFactor = 0.08,
): number {
  const clampedSourceDb = clampDecibels(sourceDb);
  const r = Math.max(1.0, distanceUnits);
  // Geometric divergence: 20 * log10(r) + atmospheric/partition absorption
  const decay = 18 * Math.log10(r) + absorptionFactor * r;
  return clampDecibels(Number((clampedSourceDb - decay).toFixed(1)));
}

/**
 * Generates continuous 2D acoustic gradient grid and evaluates desk sound levels.
 * Clamps all emitter inputs and resulting grid cells between 20 dB and 110 dB.
 */
export function generateAcousticField(
  emitters: SoundEmitter[],
  desksInput: Array<{ id: string; seatNumber: string; x: number; y: number }>,
  gridWidth = 40,
  gridHeight = 25,
): AcousticFieldMap {
  const activeEmitters = emitters
    .filter((e) => e.isActive)
    .map((e) => ({
      ...e,
      baseDecibels: clampDecibels(e.baseDecibels),
    }));

  const grid: number[][] = [];

  for (let r = 0; r < gridHeight; r++) {
    const row: number[] = [];
    const py = (r / (gridHeight - 1)) * 100;

    for (let c = 0; c < gridWidth; c++) {
      const px = (c / (gridWidth - 1)) * 100;

      // Combine acoustic energy from all active emitters: L_total = 10 * log10( sum( 10^(L_i / 10) ) )
      let totalLinearEnergy = Math.pow(10, 30 / 10); // 30 dB ambient room floor

      for (const emitter of activeEmitters) {
        const dist = Math.hypot(px - emitter.x, py - emitter.y);
        const spl = calculatePointSPL(emitter.baseDecibels, dist);
        totalLinearEnergy += Math.pow(10, spl / 10);
      }

      const combinedDecibels = clampDecibels(
        Number((10 * Math.log10(totalLinearEnergy)).toFixed(1)),
      );
      row.push(combinedDecibels);
    }
    grid.push(row);
  }

  // Calculate ratings for specific desks
  const desks: DeskSoundRating[] = desksInput.map((desk) => {
    let totalLinearEnergy = Math.pow(10, 30 / 10);
    let nearestEmitterName = "Ambient Room";
    let shortestDist = 9999;

    for (const emitter of activeEmitters) {
      const dist = Math.hypot(desk.x - emitter.x, desk.y - emitter.y);
      if (dist < shortestDist) {
        shortestDist = dist;
        nearestEmitterName = emitter.name;
      }
      const spl = calculatePointSPL(emitter.baseDecibels, dist);
      totalLinearEnergy += Math.pow(10, spl / 10);
    }

    const predictedDecibels = clampDecibels(
      Number((10 * Math.log10(totalLinearEnergy)).toFixed(1)),
    );

    // Call suitability: 100 at <= 38dB, drops to 0 at >= 65dB
    const callSuitabilityScore = Math.max(
      5,
      Math.min(100, Math.round(100 - (predictedDecibels - 36) * 3.3)),
    );

    return {
      seatId: desk.id,
      seatNumber: desk.seatNumber,
      x: desk.x,
      y: desk.y,
      predictedDecibels,
      nearestEmitter: nearestEmitterName,
      distanceToEmitterMeters: Number((shortestDist * 0.25).toFixed(1)), // approximate 1 unit = 0.25m
      callSuitabilityScore,
    };
  });

  return {
    gridWidth,
    gridHeight,
    grid,
    emitters,
    desks,
  };
}

/**
 * Maps a decibel value to RGBA color for heatmap rendering.
 * Clamps dB between 20 dB and 110 dB before color ramp interpolation.
 */
export function decibelsToRgba(db: number): [number, number, number, number] {
  const clampedDb = clampDecibels(db);
  if (clampedDb <= 38) {
    // Deep Focus Emerald (20-38 dB)
    return [16, 185, 129, 0.75];
  } else if (clampedDb <= 46) {
    // Gentle Cyan (39-46 dB)
    return [6, 182, 212, 0.75];
  } else if (clampedDb <= 56) {
    // Amber Buzz (47-56 dB)
    return [245, 158, 11, 0.8];
  } else {
    // Noise Hazard Crimson (>56 dB up to 110 dB)
    return [239, 68, 68, 0.85];
  }
}
