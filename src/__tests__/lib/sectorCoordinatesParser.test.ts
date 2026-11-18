import {
  parseSectorCoordinates,
  isMilitaryCoordinatesQuery,
  resolveLocationQuery,
  createBoundingBox,
  SECTOR_2814_MAP,
} from "@/lib/chat/sectorCoordinatesParser";

describe("Sector2814CoordinatesParser (#6315)", () => {
  describe("Sector 2814 Coordinate Extraction", () => {
    it("parses Sector 2814.Alpha and resolves to San Francisco", () => {
      const res = parseSectorCoordinates("Lock coordinates to Sector 2814.Alpha now");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("SECTOR");
      expect(res?.coordinates.lat).toBeCloseTo(37.7749, 3);
      expect(res?.coordinates.lng).toBeCloseTo(-122.4194, 3);
      expect(res?.sectorLabel).toContain("San Francisco");
      expect(res?.boundingBox.north).toBeGreaterThan(res!.coordinates.lat);
      expect(res?.boundingBox.south).toBeLessThan(res!.coordinates.lat);
    });

    it("parses Sector 2814.Bravo and resolves to London", () => {
      const res = parseSectorCoordinates("Scanning Sector 2814.Bravo for meeting rooms");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("SECTOR");
      expect(res?.coordinates.lat).toBeCloseTo(51.5074, 3);
      expect(res?.coordinates.lng).toBeCloseTo(-0.1278, 3);
      expect(res?.sectorLabel).toContain("London");
    });

    it("parses Sector 2814.Charlie and resolves to Tokyo", () => {
      const res = parseSectorCoordinates("Vector Sector 2814.Charlie");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("SECTOR");
      expect(res?.coordinates.lat).toBeCloseTo(35.6762, 3);
      expect(res?.coordinates.lng).toBeCloseTo(139.6503, 3);
    });

    it("parses base Sector 2814 and returns default Earth HQ", () => {
      const res = parseSectorCoordinates("Engage Sector 2814");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("SECTOR");
      expect(res?.coordinates.lat).toBe(SECTOR_2814_MAP.default.lat);
    });
  });

  describe("Aviation / Military Grid Parsing", () => {
    it("parses Grid 37N122W notation", () => {
      const res = parseSectorCoordinates("Target area Grid 37N122W");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("GRID");
      expect(res?.coordinates.lat).toBe(37);
      expect(res?.coordinates.lng).toBe(-122);
    });

    it("parses Grid with decimal degrees e.g. 40.7N, 74.0W", () => {
      const res = parseSectorCoordinates("Grid 40.7N, 74.0W");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("GRID");
      expect(res?.coordinates.lat).toBe(40.7);
      expect(res?.coordinates.lng).toBe(-74.0);
    });
  });

  describe("Tactical Target / Waypoint Parsing", () => {
    it("parses Target SF-01", () => {
      const res = parseSectorCoordinates("Execute reconnaissance on Target SF-01");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("TARGET");
      expect(res?.coordinates.lat).toBeCloseTo(37.7749, 3);
      expect(res?.sectorLabel).toContain("Target SF-01");
    });

    it("parses Waypoint NYC-02", () => {
      const res = parseSectorCoordinates("Setting waypoint NYC-02");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("TARGET");
      expect(res?.coordinates.lat).toBeCloseTo(40.7128, 3);
      expect(res?.coordinates.lng).toBeCloseTo(-74.006, 3);
    });
  });

  describe("MGRS Military Grid Reference Parsing", () => {
    it("parses MGRS 10SEG coordinates", () => {
      const res = parseSectorCoordinates("Coordinates MGRS 10SEG 05 34");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("MGRS");
      expect(res?.coordinates.lat).toBeCloseTo(37.7749, 3);
    });
  });

  describe("Decimal Coordinates Parsing", () => {
    it("parses decimal latitude and longitude", () => {
      const res = parseSectorCoordinates("Deploy near 37.7833, -122.4167");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("DECIMAL");
      expect(res?.coordinates.lat).toBeCloseTo(37.7833, 3);
      expect(res?.coordinates.lng).toBeCloseTo(-122.4167, 3);
    });
  });

  describe("Natural Language City Fallback", () => {
    it("falls back to London for queries mentioning London", () => {
      const res = parseSectorCoordinates("Find quiet desks near London");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("CITY_FALLBACK");
      expect(res?.coordinates.lat).toBeCloseTo(51.5074, 3);
      expect(res?.sectorLabel).toContain("London");
    });

    it("falls back to San Francisco for queries mentioning San Francisco", () => {
      const res = parseSectorCoordinates("Show me venues in San Francisco");
      expect(res).not.toBeNull();
      expect(res?.format).toBe("CITY_FALLBACK");
      expect(res?.coordinates.lat).toBeCloseTo(37.7749, 3);
    });
  });

  describe("Utility & Coordinator Helpers", () => {
    it("isMilitaryCoordinatesQuery correctly flags coordinate queries", () => {
      expect(isMilitaryCoordinatesQuery("Fly to Sector 2814")).toBe(true);
      expect(isMilitaryCoordinatesQuery("Target SF-01")).toBe(true);
      expect(isMilitaryCoordinatesQuery("Check Grid 37N122W")).toBe(true);
      expect(isMilitaryCoordinatesQuery("What is the weather today?")).toBe(false);
    });

    it("resolveLocationQuery returns fallback when no patterns match", () => {
      const res = resolveLocationQuery("completely random sentence without location");
      expect(res).toBeDefined();
      expect(res.coordinates).toBeDefined();
      expect(res.boundingBox).toBeDefined();
    });

    it("createBoundingBox generates accurate directional bounds", () => {
      const box = createBoundingBox(37.7749, -122.4194, 10);
      expect(box.north).toBeGreaterThan(37.7749);
      expect(box.south).toBeLessThan(37.7749);
      expect(box.east).toBeGreaterThan(-122.4194);
      expect(box.west).toBeLessThan(-122.4194);
    });
  });
});
