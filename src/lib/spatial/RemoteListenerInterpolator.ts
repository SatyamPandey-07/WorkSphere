import { SpatialAudioRouter } from "./SpatialAudioRouter";

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface SpatialListenerUpdate {
  type: "spatial_listener_update";
  userId: string;
  position: Vector3D;
  forward: Vector3D;
  up: Vector3D;
  timestamp: number;
}

export const MIN_POSITION = -100.0;
export const MAX_POSITION = 100.0;
export const MIN_ORIENTATION = -1.0;
export const MAX_ORIENTATION = 1.0;

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

function clampVector(v: Vector3D, min: number, max: number): Vector3D {
  return {
    x: clamp(v.x, min, max),
    y: clamp(v.y, min, max),
    z: clamp(v.z, min, max),
  };
}

function normalizeVector(v: Vector3D): Vector3D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) {
    return { x: 0, y: 0, z: -1 };
  }
  return {
    x: v.x / len,
    y: v.y / len,
    z: v.z / len,
  };
}

function getTangent(
  list: SpatialListenerUpdate[],
  index: number,
  field: "position" | "forward",
): Vector3D {
  const N = list.length;
  if (N < 2) {
    return { x: 0, y: 0, z: 0 };
  }

  if (index === 0) {
    const p0 = list[0][field];
    const p1 = list[1][field];
    const dt = list[1].timestamp - list[0].timestamp;
    if (dt <= 0) return { x: 0, y: 0, z: 0 };
    return {
      x: (p1.x - p0.x) / dt,
      y: (p1.y - p0.y) / dt,
      z: (p1.z - p0.z) / dt,
    };
  }

  if (index === N - 1) {
    const pN_2 = list[N - 2][field];
    const pN_1 = list[N - 1][field];
    const dt = list[N - 1].timestamp - list[N - 2].timestamp;
    if (dt <= 0) return { x: 0, y: 0, z: 0 };
    return {
      x: (pN_1.x - pN_2.x) / dt,
      y: (pN_1.y - pN_2.y) / dt,
      z: (pN_1.z - pN_2.z) / dt,
    };
  }

  const pPrev = list[index - 1][field];
  const pNext = list[index + 1][field];
  const dt = list[index + 1].timestamp - list[index - 1].timestamp;
  if (dt <= 0) return { x: 0, y: 0, z: 0 };
  return {
    x: (pNext.x - pPrev.x) / dt,
    y: (pNext.y - pPrev.y) / dt,
    z: (pNext.z - pPrev.z) / dt,
  };
}

function interpolateHermite(
  p0: number,
  m0: number,
  p1: number,
  m1: number,
  h: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * p0 + h10 * h * m0 + h01 * p1 + h11 * h * m1;
}

export class RemoteListenerInterpolator {
  private history = new Map<string, SpatialListenerUpdate[]>();
  private readonly maxHistory: number;
  private handleResizeBound: () => void;

  constructor(maxHistory = 4) {
    this.maxHistory = maxHistory;
    this.handleResizeBound = this.handleResize.bind(this);
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.handleResizeBound);
    }
  }

  /**
   * Store update sample in history and apply directly to SpatialAudioRouter.
   */
  applyUpdate(update: SpatialListenerUpdate, router: SpatialAudioRouter): void {
    const list = this.history.get(update.userId) ?? [];

    const clampedPos = clampVector(update.position, MIN_POSITION, MAX_POSITION);
    const clampedForward = clampVector(
      update.forward,
      MIN_ORIENTATION,
      MAX_ORIENTATION,
    );
    const clampedUp = clampVector(update.up, MIN_ORIENTATION, MAX_ORIENTATION);

    const sanitizedUpdate: SpatialListenerUpdate = {
      ...update,
      position: clampedPos,
      forward: clampedForward,
      up: clampedUp,
    };

    list.push(sanitizedUpdate);
    if (list.length > this.maxHistory) {
      list.shift();
    }
    this.history.set(update.userId, list);

    router.updatePeerPosition(
      update.userId,
      clampedPos.x,
      clampedPos.y,
      clampedPos.z,
    );

    const normalizedForward = normalizeVector(clampedForward);
    router.updatePeerOrientation(
      update.userId,
      normalizedForward.x,
      normalizedForward.y,
      normalizedForward.z,
    );
  }

  /**
   * Interpolates position vector between history samples at target timestamp.
   */
  interpolate(
    userId: string,
    atTime: number,
  ): { position: Vector3D; forward: Vector3D } | null {
    const list = this.history.get(userId);
    if (!list || list.length === 0) return null;

    if (list.length === 1) {
      return {
        position: clampVector(list[0].position, MIN_POSITION, MAX_POSITION),
        forward: normalizeVector(
          clampVector(list[0].forward, MIN_ORIENTATION, MAX_ORIENTATION),
        ),
      };
    }

    let beforeIdx = 0;
    let afterIdx = list.length - 1;

    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].timestamp <= atTime && list[i + 1].timestamp >= atTime) {
        beforeIdx = i;
        afterIdx = i + 1;
        break;
      }
    }

    const before = list[beforeIdx];
    const after = list[afterIdx];
    const duration = after.timestamp - before.timestamp;
    const t =
      duration > 0
        ? Math.max(0, Math.min(1, (atTime - before.timestamp) / duration))
        : 0;

    const m0 = getTangent(list, beforeIdx, "position");
    const m1 = getTangent(list, afterIdx, "position");

    const fm0 = getTangent(list, beforeIdx, "forward");
    const fm1 = getTangent(list, afterIdx, "forward");

    const interpPos = {
      x: interpolateHermite(
        before.position.x,
        m0.x,
        after.position.x,
        m1.x,
        duration,
        t,
      ),
      y: interpolateHermite(
        before.position.y,
        m0.y,
        after.position.y,
        m1.y,
        duration,
        t,
      ),
      z: interpolateHermite(
        before.position.z,
        m0.z,
        after.position.z,
        m1.z,
        duration,
        t,
      ),
    };

    const interpForward = {
      x: interpolateHermite(
        before.forward.x,
        fm0.x,
        after.forward.x,
        fm1.x,
        duration,
        t,
      ),
      y: interpolateHermite(
        before.forward.y,
        fm0.y,
        after.forward.y,
        fm1.y,
        duration,
        t,
      ),
      z: interpolateHermite(
        before.forward.z,
        fm0.z,
        after.forward.z,
        fm1.z,
        duration,
        t,
      ),
    };

    return {
      position: clampVector(interpPos, MIN_POSITION, MAX_POSITION),
      forward: normalizeVector(
        clampVector(interpForward, MIN_ORIENTATION, MAX_ORIENTATION),
      ),
    };
  }

  clearUser(userId: string): void {
    this.history.delete(userId);
  }

  clearAll(): void {
    this.history.clear();
  }

  getUserIds(): string[] {
    return Array.from(this.history.keys());
  }

  getHistory(userId: string): SpatialListenerUpdate[] | undefined {
    return this.history.get(userId);
  }

  private handleResize(): void {
    // Window resized, recalibrating spatial listener coordinates if needed
  }

  dispose(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.handleResizeBound);
    }
  }
}

// --- Spatial Attenuation Constants & Math ---
export const REF_DISTANCE = 1.0; // Inner boundary (meters)
export const MAX_DISTANCE = 30.0; // Outer boundary (meters)
export const ROLLOFF_FACTOR = 1.0;

/**
 * Calculates the audio gain multiplier based on distance.
 * Utilizes an inverse distance logarithmic attenuation curve.
 * @param distance The physical distance between source and listener
 * @returns A gain value between 0.0 and 1.0
 */
export function calculateSpatialAttenuation(distance: number): number {
  // If the user is closer than the reference distance, play at full volume
  if (distance <= REF_DISTANCE) {
    return 1.0;
  }

  // If the user is further than the max distance, cut the sound completely
  if (distance >= MAX_DISTANCE) {
    return 0.0;
  }

  // Apply the inverse distance attenuation formula
  const gain =
    REF_DISTANCE / (REF_DISTANCE + ROLLOFF_FACTOR * (distance - REF_DISTANCE));

  // Return the gain rounded to 4 decimal places for clean audio processing
  return Number(gain.toFixed(4));
}
