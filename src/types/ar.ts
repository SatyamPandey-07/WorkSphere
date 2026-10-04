export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export function isFiniteVector3(value: unknown): value is Vector3 {
  if (typeof value !== "object" || value === null) return false;

  const vector = value as Partial<Vector3>;
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

export interface DeskAnchor {
  id: string;
  deskNumber: string;
  position: Vector3;
  floor: number;
}
