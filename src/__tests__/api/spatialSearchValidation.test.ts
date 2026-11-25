import { NextRequest } from "next/server";
import { POST, buildBoundingBoxQuery } from "@/app/api/search/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

describe("Spatial Search POST Validation (#9860)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      {
        id: "v-1",
        name: "Test Cafe",
        category: "cafe",
        latitude: 40.71,
        longitude: -74.0,
      },
    ]);
  });

  describe("Malformed Query Field Types", () => {
    it("returns HTTP 400 when query is a number instead of a string", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({ query: 12345 }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid search parameters");
      expect(data.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "query",
          }),
        ]),
      );
    });

    it("returns HTTP 400 when query is a boolean", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({ query: true }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid search parameters");
    });

    it("returns HTTP 400 when query is an array", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({ query: ["coffee", "tea"] }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid search parameters");
    });

    it("returns HTTP 400 when query is an object", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({ query: { term: "coffee" } }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid search parameters");
    });

    it("returns HTTP 400 when category is a number", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({ category: 42 }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid search parameters");
    });
  });

  describe("Malformed Coordinates and Bounds", () => {
    it("returns HTTP 400 when coordinate is not a number", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({ minLat: "forty" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid search parameters");
    });

    it("returns HTTP 400 when latitude is out of bounds (-90 to 90)", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({ maxLat: 95.5 }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid search parameters");
    });

    it("returns HTTP 400 when longitude is out of bounds (-180 to 180)", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({ minLon: -190 }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid search parameters");
    });

    it("returns HTTP 400 when minLat > maxLat", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({ minLat: 45.0, maxLat: 35.0 }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid search parameters");
      expect(data.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "minLat must be less than or equal to maxLat",
          }),
        ]),
      );
    });
  });

  describe("Malformed Request Body", () => {
    it("returns HTTP 400 when body is an array instead of an object", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify([{ query: "cafe" }]),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Request body must be a JSON object");
    });

    it("returns HTTP 400 when body contains invalid JSON", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: "{ malformed json",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe("Invalid JSON in request body");
    });
  });

  describe("Valid Search Requests", () => {
    it("succeeds with valid string query and bounding box", async () => {
      const req = new NextRequest("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify({
          query: "Central Cafe",
          category: "cafe",
          minLon: -74.1,
          maxLon: -73.9,
          minLat: 40.7,
          maxLat: 40.8,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.venues).toHaveLength(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("succeeds with anti-meridian longitude bounds (minLon > maxLon)", async () => {
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
    });
  });

  describe("buildBoundingBoxQuery robustness", () => {
    it("handles non-string query in options without throwing TypeError", () => {
      expect(() => {
        buildBoundingBoxQuery({ query: 12345 as unknown as string });
      }).not.toThrow();

      const result = buildBoundingBoxQuery({
        query: 12345 as unknown as string,
      });
      // Predicates should not include free-text filter
      expect(result.predicates).toHaveLength(0);
    });
  });
});
