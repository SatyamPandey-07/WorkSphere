export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export function calculateDistance(v1: Vector3, v2: Vector3): number {
  if (!v1 || !v2 || typeof v1.x !== "number" || typeof v2.x !== "number") {
    return 0;
  }
  const dx = (v2.x ?? 0) - (v1.x ?? 0);
  const dy = (v2.y ?? 0) - (v1.y ?? 0);
  const dz = (v2.z ?? 0) - (v1.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function normalizeVector(v1: Vector3, v2: Vector3): Vector3 {
  if (!v1 || !v2 || typeof v1.x !== "number" || typeof v2.x !== "number") {
    return { x: 0, y: 0, z: 0 };
  }
  const dx = (v2.x ?? 0) - (v1.x ?? 0);
  const dy = (v2.y ?? 0) - (v1.y ?? 0);
  const dz = (v2.z ?? 0) - (v1.z ?? 0);

  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length === 0) return { x: 0, y: 0, z: 0 };

  return {
    x: dx / length,
    y: dy / length,
    z: dz / length,
  };
}
