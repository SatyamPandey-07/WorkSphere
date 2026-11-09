import { POST } from "@/app/api/telemetry/batch/route";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { NextRequest } from "next/server";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => any;
declare const beforeEach: (fn: () => void) => void;
declare const jest: any;

jest.mock("@/lib/prisma", () => ({
  prisma: {
    noiseReading: {
      createMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
}));

describe("POST /api/telemetry/batch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (rateLimit as jest.Mock).mockResolvedValue(true);
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

  it("persists valid batch of up to 50 readings", async () => {
    const validReadings = Array.from({ length: 50 }, (_, i) => ({
      venueId: `venue-${i}`,
      decibels: 45.5 + (i % 10),
      peakDecibels: 60.0 + (i % 10),
      timestamp: Date.now() - i * 1000,
    }));

    (prisma as any).noiseReading.createMany.mockResolvedValue({
      count: 50,
    });

    const req = createRequest({ readings: validReadings });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBe(50);

    expect((prisma as any).noiseReading.createMany).toHaveBeenCalledTimes(1);
    expect((prisma as any).noiseReading.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          venueId: "venue-0",
          decibels: 45.5,
          peakDecibels: 60.0,
          timestamp: expect.any(Date),
        }),
      ]),
    });
  });

  it("returns 400 for empty readings array", async () => {
    const req = createRequest({ readings: [] });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
    expect((prisma as any).noiseReading.createMany).not.toHaveBeenCalled();
  });

  it("returns 400 when payload exceeds 50 readings", async () => {
    const tooManyReadings = Array.from({ length: 51 }, (_, i) => ({
      venueId: `venue-${i}`,
      decibels: 50,
      peakDecibels: 60,
      timestamp: Date.now(),
    }));

    const req = createRequest({ readings: tooManyReadings });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
    expect((prisma as any).noiseReading.createMany).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed payload items", async () => {
    const malformedReadings = [
      {
        venueId: "", // empty venueId
        decibels: -5, // negative decibels
        peakDecibels: 50,
        timestamp: "not-a-number",
      },
    ];

    const req = createRequest({ readings: malformedReadings });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
    expect((prisma as any).noiseReading.createMany).not.toHaveBeenCalled();
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
          decibels: 50,
          peakDecibels: 65,
          timestamp: Date.now(),
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
    expect((prisma as any).noiseReading.createMany).not.toHaveBeenCalled();
  });

  it("returns 500 when database insertion fails", async () => {
    (prisma as any).noiseReading.createMany.mockRejectedValue(
      new Error("Database connection timeout"),
    );

    const req = createRequest({
      readings: [
        {
          venueId: "venue-1",
          decibels: 50,
          peakDecibels: 65,
          timestamp: Date.now(),
        },
      ],
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to persist telemetry readings");
  });
});
