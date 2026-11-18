/**
 * QuietZoneGeofence.ts
 * Evaluates high-precision BLE coordinates against venue polygon maps to determine 
 * if a user is inside a restricted quiet zone using the Ray Casting algorithm.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Polygon {
  id: string;
  name: string;
  vertices: Point[];
  maxDecibels: number; // Threshold for this specific zone
}

export class QuietZoneGeofence {
  private zones: Map<string, Polygon> = new Map();

  public addZone(zone: Polygon): void {
    if (zone.vertices.length < 3) {
      throw new Error('A polygon must have at least 3 vertices');
    }
    this.zones.set(zone.id, zone);
  }

  public removeZone(zoneId: string): void {
    this.zones.delete(zoneId);
  }

  public getZone(zoneId: string): Polygon | undefined {
    return this.zones.get(zoneId);
  }

  public getAllZones(): Polygon[] {
    return Array.from(this.zones.values());
  }

  /**
   * Ray Casting algorithm to determine if a point is inside a polygon.
   * @param point The user's current coordinates
   * @param polygon The polygon to check against
   * @returns true if the point is inside the polygon
   */
  public isPointInPolygon(point: Point, polygon: Polygon): boolean {
    let inside = false;
    const vertices = polygon.vertices;
    const n = vertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = vertices[i].x;
      const yi = vertices[i].y;
      const xj = vertices[j].x;
      const yj = vertices[j].y;

      const intersect =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }

    return inside;
  }

  /**
   * Checks if the user is inside ANY quiet zone and returns the zone details.
   * @param point The user's current coordinates
   * @returns The polygon if inside a zone, otherwise null
   */
  public getCurrentZone(point: Point): Polygon | null {
    for (const zone of this.zones.values()) {
      if (this.isPointInPolygon(point, zone)) {
        return zone;
      }
    }
    return null;
  }

  /**
   * Calculates the distance from a point to the nearest edge of a polygon.
   * Useful for "approaching quiet zone" warnings.
   */
  public distanceToZone(point: Point, polygon: Polygon): number {
    let minDist = Infinity;
    const vertices = polygon.vertices;
    const n = vertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const dist = this.pointToSegmentDistance(
        point,
        vertices[j],
        vertices[i]
      );
      if (dist < minDist) {
        minDist = dist;
      }
    }

    return minDist;
  }

  private pointToSegmentDistance(p: Point, v: Point, w: Point): number {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);

    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));

    const proj = {
      x: v.x + t * (w.x - v.x),
      y: v.y + t * (w.y - v.y),
    };

    return Math.sqrt((p.x - proj.x) ** 2 + (p.y - proj.y) ** 2);
  }
}