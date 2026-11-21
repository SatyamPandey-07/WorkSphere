import { POST, telemetryReadingSchema, validateTelemetryBatchParallel } from "@/app/api/telemetry/batch/route";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { NextRequest } from "next/server";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => any;
declare const beforeEach: (fn: () => void) => void;
declare const afterEach: (fn: () => void) => void;
declare const jest: any;

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueTelemetry: {
      createMany: jest.fn(),
    },
    noiseReading: {
      createMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
  getClientIp: jest.fn((req) => req?.headers?.get("x-forwarded-for") || "127.0.0.1"),
}));

describe("POST /api/telemetry/batch", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GATEWAY_API_TOKEN;
    delete process.env.TELEMETRY_GATEWAY_TOKEN;
    delete process.env.WORKER_SECRET;
    (rateLimit as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createRequest = (body: any, headers: Record<string, string> = {}) => {
    return new NextRequest("http://localhost/api/telemetry/batch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "127.0.0.1",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  };

  it("persists valid batch of up to 100 sensor readings with single prisma.venueTelemetry.createMany call", async () => {
    const validReadings = Array.from({ length: 100 }, (_, i) => ({
      venueId: `venue-${i}`,
      roomId: `room-${i % 5}`,
      sensorId: `sensor-${i}`,
      type: "noise",
      value: 45.5 + (i % 10),
      recordedAt: new Date(Date.now() - i * 1000).toISOString(),
    }));

    (prisma as any).venueTelemetry.createMany.mockResolvedValue({
      count: 100,
    });

    const req = createRequest({ readings: validReadings });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBe(100);

    expect((prisma as any).venueTelemetry.createMany).toHaveBeenCalledTimes(1);
    expect((prisma as any).venueTelemetry.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          venueId: "venue-0",
          roomId: "room-0",
          sensorId: "sensor-0",
          type: "noise",
          value: 45.5,
          recordedAt: expect.any(Date),
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it("persists legacy decibel noise readings format seamlessly", async () => {
    const legacyReadings = [
      {
        venueId: "venue-legacy",
        decibels: 55.2,
        peakDecibels: 68.4,
        timestamp: Date.now(),
      },
    ];

    (prisma as any).venueTelemetry.createMany.mockResolvedValue({
      count: 1,
    });

    const req = createRequest({ readings: legacyReadings });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBe(1);

    expect((prisma as any).venueTelemetry.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          venueId: "venue-legacy",
          type: "noise",
          value: 55.2,
          recordedAt: expect.any(Date),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("returns 400 for empty readings array", async () => {
    const req = createRequest({ readings: [] });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
    expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
  });

  it("returns 400 when payload exceeds 100 readings", async () => {
    const tooManyReadings = Array.from({ length: 101 }, (_, i) => ({
      venueId: `venue-${i}`,
      type: "co2",
      value: 450,
      recordedAt: new Date().toISOString(),
    }));

    const req = createRequest({ readings: tooManyReadings });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
    expect(json.details).toContain("cannot exceed 100 items");
    expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed payload items with parallel Zod validation errors", async () => {
    const malformedReadings = [
      {
        venueId: "", // empty venueId
        type: "noise",
        value: 50,
      },
      {
        venueId: "venue-2",
        // missing both value and decibels
      },
    ];

    const req = createRequest({ readings: malformedReadings });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
    expect(Array.isArray(json.details)).toBe(true);
    expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
  });

  it("validates telemetry records in parallel using validateTelemetryBatchParallel", async () => {
    const records = [
      { venueId: "venue-a", value: 10 },
      { venueId: "venue-b", value: 20 },
    ];
    const results = await validateTelemetryBatchParallel(records);
    expect(results).toHaveLength(2);
    expect(results[0].result.success).toBe(true);
    expect(results[1].result.success).toBe(true);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = createRequest("not a valid json string");
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON payload");
  });

  it("returns 429 when rate limit is exceeded (60 req/min)", async () => {
    (rateLimit as jest.Mock).mockResolvedValue(false);

    const req = createRequest({
      readings: [
        {
          venueId: "venue-1",
          value: 50,
        },
      ],
    });

    const res = await POST(req);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Too many requests");
    expect(rateLimit).toHaveBeenCalledWith(
      "telemetry:batch:127.0.0.1",
      60,
      60_000,
    );
    expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
  });

  it("enforces gateway API token authentication when GATEWAY_API_TOKEN is configured", async () => {
    process.env.GATEWAY_API_TOKEN = "super-secret-token-123";

    // 1. Missing token -> 401
    const unauthReq = createRequest({ readings: [{ venueId: "v1", value: 42 }] });
    const unauthRes = await POST(unauthReq);
    expect(unauthRes.status).toBe(401);

    // 2. Invalid token -> 401
    const invalidReq = createRequest(
      { readings: [{ venueId: "v1", value: 42 }] },
      { authorization: "Bearer invalid-token" },
    );
    const invalidRes = await POST(invalidReq);
    expect(invalidRes.status).toBe(401);

    // 3. Valid Bearer token -> 201
    (prisma as any).venueTelemetry.createMany.mockResolvedValue({ count: 1 });
    const validBearerReq = createRequest(
      { readings: [{ venueId: "v1", value: 42 }] },
      { authorization: "Bearer super-secret-token-123" },
    );
    const validBearerRes = await POST(validBearerReq);
    expect(validBearerRes.status).toBe(201);

    // 4. Valid x-gateway-token custom header -> 201
    const validHeaderReq = createRequest(
      { readings: [{ venueId: "v1", value: 42 }] },
      { "x-gateway-token": "super-secret-token-123" },
    );
    const validHeaderRes = await POST(validHeaderReq);
    expect(validHeaderRes.status).toBe(201);
  });

  it("returns 500 when database insertion fails", async () => {
    (prisma as any).venueTelemetry.createMany.mockRejectedValue(
      new Error("Database connection timeout"),
    );

    const req = createRequest({
      readings: [
        {
          venueId: "venue-1",
          value: 50,
        },
      ],
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to persist telemetry readings");
  });
});
