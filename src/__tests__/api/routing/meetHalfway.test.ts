import { NextRequest } from "next/server";
import {
  POST,
  MAX_SEARCH_RADIUS_KM,
} from "@/app/api/routing/meet-halfway/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findMany: jest.fn(),
    },
  },
}));

const mockFindMany = prisma.venue.findMany as jest.Mock;

const BASE_URL = "http://localhost:3000/api/routing/meet-halfway";

const validMember = {
  id: "mem-1",
  name: "Alex",
  latitude: 37.7749,
  longitude: -122.4194,
  transitMode: "transit" as const,
};

const validMember2 = {
  id: "mem-2",
  name: "Jordan",
  latitude: 37.7833,
  longitude: -122.4167,
  transitMode: "bicycling" as const,
};

function createRequest(body: unknown): NextRequest {
  return new NextRequest(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/routing/meet-halfway - Request Validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
  });

  describe("A. Request body validation", () => {
    test.each([
      ["malformed JSON string", "{ not-valid-json"],
      ["empty string body", ""],
      ["JSON null", "null"],
      ["root string", '"hello world"'],
      ["root number", "42"],
      ["root boolean", "true"],
      ["root array", "[]"],
      ["root array with objects", '[{"id":"1"}]'],
    ])(
      "rejects %s with HTTP 400 and does not invoke database",
      async (_, body) => {
        const req = createRequest(body);
        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBeDefined();
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test("rejects empty body when no body is passed to NextRequest", async () => {
      const req = new NextRequest(BASE_URL, { method: "POST" });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBeDefined();
      expect(mockFindMany).not.toHaveBeenCalled();
    });
  });

  describe("B. Members array validation", () => {
    test.each([
      ["missing members field", {}],
      ["empty members array", { members: [] }],
      ["members is string", { members: "not-an-array" }],
      ["members is number", { members: 123 }],
      ["members is boolean", { members: true }],
      ["members is null", { members: null }],
      ["members is object", { members: { id: "1" } }],
      ["member entry is null", { members: [null, validMember2] }],
      [
        "member entry is primitive string",
        { members: ["invalid", validMember2] },
      ],
      ["member entry is primitive number", { members: [123, validMember2] }],
      ["member entry is primitive boolean", { members: [true, validMember2] }],
      ["member entry is array", { members: [[], validMember2] }],
      ["member entry is empty object", { members: [{}, validMember2] }],
      [
        "member missing id",
        {
          members: [
            { name: "Alex", latitude: 37.77, longitude: -122.41 },
            validMember2,
          ],
        },
      ],
      [
        "member missing name",
        {
          members: [
            { id: "1", latitude: 37.77, longitude: -122.41 },
            validMember2,
          ],
        },
      ],
      [
        "member empty id",
        {
          members: [
            { id: "", name: "Alex", latitude: 37.77, longitude: -122.41 },
            validMember2,
          ],
        },
      ],
      [
        "member whitespace-only id",
        {
          members: [
            { id: "   ", name: "Alex", latitude: 37.77, longitude: -122.41 },
            validMember2,
          ],
        },
      ],
      [
        "member empty name",
        {
          members: [
            { id: "1", name: "", latitude: 37.77, longitude: -122.41 },
            validMember2,
          ],
        },
      ],
      [
        "member whitespace-only name",
        {
          members: [
            { id: "1", name: "   ", latitude: 37.77, longitude: -122.41 },
            validMember2,
          ],
        },
      ],
    ])(
      "rejects %s with HTTP 400 without invoking database",
      async (_, payload) => {
        const req = createRequest(payload);
        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBeDefined();
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test("rejects request with only one valid member with HTTP 400 and descriptive details", async () => {
      const req = createRequest({ members: [validMember] });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid request parameters");
      expect(data.details.fieldErrors.members).toContain(
        "At least two team member coordinates are required",
      );
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    test("rejects request with two members having identical coordinates with HTTP 400", async () => {
      const duplicateLocationMember = {
        id: "mem-duplicate-id",
        name: "Jordan Duplicate",
        latitude: validMember.latitude,
        longitude: validMember.longitude,
      };
      const req = createRequest({
        members: [validMember, duplicateLocationMember],
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid request parameters");
      expect(data.details.fieldErrors.members).toContain(
        "At least two distinct member locations are required",
      );
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    test("accepts request with two members having distinct coordinates with HTTP 200", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    test("accepts request with duplicate coordinates as long as at least two distinct locations exist", async () => {
      const duplicateLocationMember = {
        id: "mem-3",
        name: "Alex Clone",
        latitude: validMember.latitude,
        longitude: validMember.longitude,
      };
      const req = createRequest({
        members: [validMember, duplicateLocationMember, validMember2],
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("C. Coordinate validation", () => {
    test.each([
      ["latitude > 90", { ...validMember, latitude: 90.0001 }],
      ["latitude = 120", { ...validMember, latitude: 120 }],
      ["latitude < -90", { ...validMember, latitude: -90.0001 }],
      ["latitude = -150", { ...validMember, latitude: -150 }],
      ["longitude > 180", { ...validMember, longitude: 180.0001 }],
      ["longitude = 200", { ...validMember, longitude: 200 }],
      ["longitude < -180", { ...validMember, longitude: -180.0001 }],
      ["longitude = -250", { ...validMember, longitude: -250 }],
      [
        "latitude as numeric string",
        { ...validMember, latitude: "37.7749" as unknown as number },
      ],
      [
        "longitude as numeric string",
        { ...validMember, longitude: "-122.4194" as unknown as number },
      ],
      [
        "latitude is null",
        { ...validMember, latitude: null as unknown as number },
      ],
      [
        "longitude is null",
        { ...validMember, longitude: null as unknown as number },
      ],
    ])(
      "rejects out-of-range or non-numeric coordinate (%s) with HTTP 400",
      async (_, member) => {
        const req = createRequest({ members: [member, validMember2] });
        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBeDefined();
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["latitude is NaN", NaN, 0],
      ["latitude is Infinity", Infinity, 0],
      ["latitude is -Infinity", -Infinity, 0],
      ["longitude is NaN", 0, NaN],
      ["longitude is Infinity", 0, Infinity],
      ["longitude is -Infinity", 0, -Infinity],
    ])(
      "rejects non-finite coordinate via mocked parsed body (%s) with HTTP 400",
      async (_, lat, lng) => {
        const req = createRequest({});
        jest.spyOn(req, "json").mockResolvedValue({
          members: [
            { id: "mem-1", name: "Alex", latitude: lat, longitude: lng },
            validMember2,
          ],
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBeDefined();
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["maximum latitude 90", 90, 0],
      ["minimum latitude -90", -90, 0],
      ["maximum longitude 180", 0, 180],
      ["minimum longitude -180", 0, -180],
      ["zero coordinates (equator/prime meridian)", 0, 0],
    ])("accepts inclusive coordinate boundary (%s)", async (_, lat, lng) => {
      const req = createRequest({
        members: [
          {
            id: "mem-boundary",
            name: "Boundary Tester",
            latitude: lat,
            longitude: lng,
          },
          validMember2,
        ],
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("D. Member transit mode", () => {
    test.each(["transit", "driving", "bicycling", "walking"] as const)(
      "accepts supported member transit mode: %s",
      async (mode) => {
        const req = createRequest({
          members: [{ ...validMember, transitMode: mode }, validMember2],
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
        expect(mockFindMany).toHaveBeenCalledTimes(1);
      },
    );

    test.each(["teleport", "airplane", "subway", "run", "CAR", ""])(
      "rejects unsupported member transit mode (%s)",
      async (unsupportedMode) => {
        const req = createRequest({
          members: [
            { ...validMember, transitMode: unsupportedMode },
            validMember2,
          ],
        });

        const res = await POST(req);
        expect(res.status).toBe(400);
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test("accepts omitted transitMode property", async () => {
      const { transitMode: _transitMode, ...memberWithoutMode } = validMember;
      const req = createRequest({
        members: [memberWithoutMode, validMember2],
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("E. Search radius validation", () => {
    test.each([
      ["zero radius", 0],
      ["negative radius", -10],
      ["above max radius (100.1 km)", 100.1],
      ["huge radius (500 km)", 500],
      ["null radius", null],
      ["numeric string radius", "25"],
    ])(
      "rejects invalid searchRadiusKm (%s) with HTTP 400",
      async (_, radius) => {
        const req = createRequest({
          members: [validMember, validMember2],
          searchRadiusKm: radius,
        });

        const res = await POST(req);
        expect(res.status).toBe(400);
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["searchRadiusKm is NaN", NaN],
      ["searchRadiusKm is Infinity", Infinity],
      ["searchRadiusKm is -Infinity", -Infinity],
    ])(
      "rejects non-finite searchRadiusKm (%s) through mocked body",
      async (_, radius) => {
        const req = createRequest({});
        jest.spyOn(req, "json").mockResolvedValue({
          members: [validMember, validMember2],
          searchRadiusKm: radius,
        });

        const res = await POST(req);
        expect(res.status).toBe(400);
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test("accepts boundary value exactly equal to MAX_SEARCH_RADIUS_KM (100 km)", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
        searchRadiusKm: MAX_SEARCH_RADIUS_KM,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.teamSummary.searchRadiusKm).toBe(100);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    test("uses existing 25 km default when searchRadiusKm is omitted", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.teamSummary.searchRadiusKm).toBe(25);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("F. Minimum seats validation", () => {
    test.each([
      ["zero seats", 0],
      ["negative seats", -3],
      ["fractional seats", 2.5],
      ["numeric string seats", "4"],
      ["null seats", null],
    ])("rejects invalid minSeats (%s) with HTTP 400", async (_, minSeats) => {
      const req = createRequest({
        members: [validMember, validMember2],
        minSeats,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    test("accepts valid positive integer for minSeats", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
        minSeats: 5,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.teamSummary.requiredSeats).toBe(5);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    test("defaults requiredSeats to members.length when minSeats is omitted", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.teamSummary.requiredSeats).toBe(2);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("G. Minimum Wi-Fi speed validation", () => {
    test.each([
      ["negative wifi speed", -10],
      ["null wifi speed", null],
      ["numeric string wifi speed", "50"],
    ])(
      "rejects invalid minWifiSpeed (%s) with HTTP 400",
      async (_, minWifiSpeed) => {
        const req = createRequest({
          members: [validMember, validMember2],
          minWifiSpeed,
        });

        const res = await POST(req);
        expect(res.status).toBe(400);
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["minWifiSpeed is NaN", NaN],
      ["minWifiSpeed is Infinity", Infinity],
    ])(
      "rejects non-finite minWifiSpeed (%s) via mocked body",
      async (_, minWifiSpeed) => {
        const req = createRequest({});
        jest.spyOn(req, "json").mockResolvedValue({
          members: [validMember, validMember2],
          minWifiSpeed,
        });

        const res = await POST(req);
        expect(res.status).toBe(400);
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test("accepts zero as a valid non-negative wifi speed", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
        minWifiSpeed: 0,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      const callArgs = mockFindMany.mock.calls[0][0];
      expect(callArgs.where.wifiSpeed).toBeUndefined();
    });

    test("accepts positive finite wifi speed and applies where filter", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
        minWifiSpeed: 75,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      const callArgs = mockFindMany.mock.calls[0][0];
      expect(callArgs.where.wifiSpeed).toEqual({ gte: 75 });
    });

    test("defaults minWifiSpeed to 0 when omitted", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      const callArgs = mockFindMany.mock.calls[0][0];
      expect(callArgs.where.wifiSpeed).toBeUndefined();
    });
  });

  describe("H. Global transit preference validation", () => {
    test.each(["transit", "walking", "balanced"] as const)(
      "accepts valid transitPreference: %s",
      async (pref) => {
        const req = createRequest({
          members: [validMember, validMember2],
          transitPreference: pref,
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
        expect(mockFindMany).toHaveBeenCalledTimes(1);
      },
    );

    test.each(["driving", "bicycling", "teleport", "flight", ""])(
      "rejects unsupported transitPreference (%s)",
      async (unsupportedPref) => {
        const req = createRequest({
          members: [validMember, validMember2],
          transitPreference: unsupportedPref,
        });

        const res = await POST(req);
        expect(res.status).toBe(400);
        expect(mockFindMany).not.toHaveBeenCalled();
      },
    );

    test("omitted transitPreference defaults to 'transit' and succeeds", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    test("propagates transitPreference to venue recommendations and reflects in member estimates", async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          id: "venue-1",
          name: "Test Venue",
          latitude: 37.775,
          longitude: -122.418,
          category: "coworking",
          address: "123 Main St",
          rating: 4.5,
          wifiSpeed: 100,
          wifiQuality: 90,
          hasOutlets: true,
          maxCapacity: 10,
          currentOccupancy: 2,
          imageUrl: null,
          seats: [{ id: "seat-1", seatNumber: "1", type: "desk" }],
        },
      ]);

      const req = createRequest({
        members: [{ ...validMember, transitMode: "driving" }, validMember2],
        transitPreference: "walking",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.recommendations).toHaveLength(1);
      expect(data.recommendations[0].memberEstimates[0].transitMode).toBe(
        "walking",
      );
    });
  });

  describe("I. Other optional fields (category, hasOutlets)", () => {
    test("rejects non-string category", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
        category: 12345,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    test("rejects non-boolean hasOutlets", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
        hasOutlets: "true",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    test("accepts valid category and hasOutlets and propagates them to Prisma query", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
        category: "coworking",
        hasOutlets: true,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      const callArgs = mockFindMany.mock.calls[0][0];
      expect(callArgs.where.category).toBe("coworking");
      expect(callArgs.where.hasOutlets).toBe(true);
    });

    test("category 'all' does not add category filter to Prisma query", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
        category: "all",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      const callArgs = mockFindMany.mock.calls[0][0];
      expect(callArgs.where.category).toBeUndefined();
    });
  });

  describe("J. Successful request execution", () => {
    test("processes valid request and preserves expected response contract and bounding box", async () => {
      const req = createRequest({
        members: [validMember, validMember2],
        category: "cafe",
        minWifiSpeed: 30,
        minSeats: 4,
        searchRadiusKm: 50,
        hasOutlets: true,
        transitPreference: "balanced",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.centroid).toBeDefined();
      expect(typeof data.centroid.latitude).toBe("number");
      expect(typeof data.centroid.longitude).toBe("number");
      expect(data.totalCandidatesEvaluated).toBe(0);
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(data.teamSummary).toEqual({
        memberCount: 2,
        requiredSeats: 4,
        searchRadiusKm: 50,
      });

      // Verify Prisma received expected bounding box filters
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      const callArgs = mockFindMany.mock.calls[0][0];
      expect(callArgs.where.category).toBe("cafe");
      expect(callArgs.where.wifiSpeed).toEqual({ gte: 30 });
      expect(callArgs.where.hasOutlets).toBe(true);
      expect(callArgs.where.latitude.gte).toBeLessThan(data.centroid.latitude);
      expect(callArgs.where.latitude.lte).toBeGreaterThan(
        data.centroid.latitude,
      );
      expect(callArgs.where.longitude.gte).toBeLessThan(
        data.centroid.longitude,
      );
      expect(callArgs.where.longitude.lte).toBeGreaterThan(
        data.centroid.longitude,
      );
      expect(callArgs.take).toBe(50);
    });
  });
});
