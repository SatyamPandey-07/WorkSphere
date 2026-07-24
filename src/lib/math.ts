import { Vector3 } from "../types/ar";

export function calculateDistance(v1: Vector3, v2: Vector3): number {
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  const dz = v2.z - v1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function normalizeVector(v1: Vector3, v2: Vector3): Vector3 {
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  const dz = v2.z - v1.z;

  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length === 0) return { x: 0, y: 0, z: 0 };

  return {
    x: dx / length,
    y: dy / length,
    z: dz / length,
  };
}
