export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface DeskAnchor {
  id: string;
  deskNumber: string;
  position: Vector3;
  floor: number;
}
