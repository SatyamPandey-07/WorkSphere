import { NextRequest } from "next/server";
import {
  GET,
  POST,
  isAntiMeridianCrossover,
  buildLongitudeBoundingCondition,
  buildBoundingBoxQuery,
} from "@/app/api/search/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

describe("Anti-Meridian (180°/-180°) Bounding Box Search (#api/search)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Detection of Anti-Meridian Crossover", () => {
    it("detects crossover when minLongitude > maxLongitude (crossing International Date Line)", () => {
      // Fiji / Pacific island bounding box crossing 180° meridian
      expect(isAntiMeridianCrossover(177.0, -178.0)).toBe(true);
      expect(isAntiMeridianCrossover(179.5, -179.5)).toBe(true);
      expect(isAntiMeridianCrossover(170.0, -160.0)).toBe(true);
    });

    it("returns false for standard bounding boxes entirely within a single hemisphere or not crossing 180°", () => {
      // San Francisco
      expect(isAntiMeridianCrossover(-122.5, -122.3)).toBe(false);
      // Tokyo
      expect(isAntiMeridianCrossover(139.6, 139.8)).toBe(false);
      // Greenwich Prime Meridian crossover (e.g. London: -0.2 to 0.1)
      expect(isAntiMeridianCrossover(-0.2, 0.1)).toBe(false);
      // Identical coordinates
      expect(isAntiMeridianCrossover(180, 180)).toBe(false);
    });
  });

  describe("SQL Longitude Condition Generation", () => {
    it("generates disjunctive OR condition for split hemispheres when minLon > maxLon", () => {
      const sqlCondition = buildLongitudeBoundingCondition(177.0, -178.0);
      const text = sqlCondition.strings.join("?");
      // Should contain OR condition splitting across hemispheres
      expect(text).toContain(">=");
      expect(text).toContain("OR");
      expect(text).toContain("<=");
      expect(sqlCondition.values).toEqual([177.0, -178.0]);
    });

    it("generates conjunctive AND condition when minLon <= maxLon", () => {
      const sqlCondition = buildLongitudeBoundingCondition(-122.5, -122.3);
      const text = sqlCondition.strings.join("?");
      expect(text).toContain(">=");
      expect(text).toContain("AND");
      expect(text).toContain("<=");
      expect(sqlCondition.values).toEqual([-122.5, -122.3]);
    });
  });

  describe("Compound SQL Query Generation", () => {
    it("builds compound SQL query splitting longitude across anti-meridian", () => {
      const { sql, isAntiMeridian } = buildBoundingBoxQuery({
        minLon: 177.0,
        maxLon: -178.0,
        minLat: -19.5,
        maxLat: -15.5,
      });

      expect(isAntiMeridian).toBe(true);

      const queryText = sql.strings.join("?");
      expect(queryText).toContain('FROM "Venue" v');
      expect(queryText).toContain("WHERE");
      expect(queryText).toContain("OR");
      expect(queryText).toContain('v."longitude" >= ? OR v."longitude" <= ?');
      expect(queryText).toContain('v."latitude" >= ? AND v."latitude" <= ?');

      expect(sql.values).toContain(177.0);
      expect(sql.values).toContain(-178.0);
      expect(sql.values).toContain(-19.5);
      expect(sql.values).toContain(-15.5);
    });
  });

  describe("Venue Search in Fiji / Pacific Island Regions", () => {
    const mockFijiVenues = [
      {
        id: "venue-fiji-suva",
        name: "Suva Nomad Co-Working",
        category: "coworking",
        address: "Victoria Parade, Suva, Fiji",
        latitude: -18.1416,
        longitude: 178.4419, // Eastern hemisphere (+178.44°)
        rating: 4.8,
      },
      {
        id: "venue-fiji-taveuni",
        name: "Taveuni Meridian Work Lounge",
        category: "cafe",
        address: "Waiyevo, Taveuni, Fiji",
        latitude: -16.79,
        longitude: -179.95, // Western hemisphere (-179.95°)
        rating: 4.9,
      },
    ];

    it("successfully queries and returns venues spanning both hemispheres across the Date Line via GET", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockFijiVenues);

      // Query covering Fiji (minLon: 177°E, maxLon: -178°W, minLat: -19.5°S, maxLat: -15.5°S)
      const req = new NextRequest(
        "http://localhost/api/search?minLon=177.0&maxLon=-178.0&minLat=-19.5&maxLat=-15.5",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.isAntiMeridianCrossover).toBe(true);
      expect(data.venues).toEqual(mockFijiVenues);
      expect(data.total).toBe(2);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const executedSql = (prisma.$queryRaw as jest.Mock).mock.calls[0][0];
      const sqlString = executedSql.strings.join("?");
      expect(sqlString).toContain("OR");
      expect(executedSql.values).toContain(177.0);
      expect(executedSql.values).toContain(-178.0);
    });

    it("supports minLongitude/maxLongitude parameter names via GET", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockFijiVenues);

      const req = new NextRequest(
        "http://localhost/api/search?minLongitude=177.0&maxLongitude=-178.0&minLatitude=-19.5&maxLatitude=-15.5",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.isAntiMeridianCrossover).toBe(true);
      expect(data.venues).toHaveLength(2);
    });

    it("supports POST request payloads with anti-meridian crossover", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockFijiVenues);

      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({
          minLon: 177.0,
          maxLon: -178.0,
          minLat: -19.5,
          maxLat: -15.5,
        }),
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.isAntiMeridianCrossover).toBe(true);
      expect(data.venues).toEqual(mockFijiVenues);
    });

    it("verifies that without anti-meridian splitting, standard conjunctive query would exclude venues", () => {
      // Simulate venue longitude checks
      const suvaLon = 178.4419;
      const taveuniLon = -179.95;
      const minLon = 177.0;
      const maxLon = -178.0;

      // Naive buggy condition: lon >= minLon AND lon <= maxLon
      const naiveCheck = (lon: number) => lon >= minLon && lon <= maxLon;
      expect(naiveCheck(suvaLon)).toBe(false); // Fails because 178.4419 is NOT <= -178.0
      expect(naiveCheck(taveuniLon)).toBe(false); // Fails because -179.95 is NOT >= 177.0

      // Fixed disjunctive condition: lon >= minLon OR lon <= maxLon
      const fixedCheck = (lon: number) => lon >= minLon || lon <= maxLon;
      expect(fixedCheck(suvaLon)).toBe(true); // Matches lon >= 177.0 (Eastern hemisphere)
      expect(fixedCheck(taveuniLon)).toBe(true); // Matches lon <= -178.0 (Western hemisphere)
    });
  });
});
