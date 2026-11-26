import {
  POST,
  telemetryReadingSchema,
  validateTelemetryBatchParallel,
  isValidTimestampValue,
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
} from "@/app/api/telemetry/batch/route";
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

describe("POST /api/telemetry/batch - Array-Bound & Timestamp Validation (#10460)", () => {
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

  describe("1. Array and Bounds Validation Before Processing", () => {
    it("rejects non-array batch payloads with 400", async () => {
      const nonArrays = [
        { readings: "not-an-array" },
        { readings: 12345 },
        { readings: null },
        { readings: { venueId: "v1", value: 42 } },
      ];

      for (const payload of nonArrays) {
        const req = createRequest(payload);
        const res = await POST(req);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe("Validation failed");
        expect(json.details).toContain("must be an array");
      }
      expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
    });

    it("rejects empty arrays with 400 before processing elements", async () => {
      const req = createRequest({ readings: [] });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Validation failed");
      expect(json.details).toContain("cannot be empty");
      expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
    });

    it("rejects oversized arrays (> 100 items) immediately without evaluating items", async () => {
      const oversized = Array.from({ length: 101 }, (_, i) => ({
        venueId: `v-${i}`,
        value: 50,
      }));

      const req = createRequest({ readings: oversized });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Validation failed");
      expect(json.details).toContain("cannot exceed 100 items");
      expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
    });

    it("validateTelemetryBatchParallel throws when passed non-array, empty array, or oversized array", async () => {
      await expect(validateTelemetryBatchParallel(null as any)).rejects.toThrow("must be an array");
      await expect(validateTelemetryBatchParallel([] as any)).rejects.toThrow("cannot be empty");
      const bigArray = new Array(101).fill({ venueId: "v", value: 1 });
      await expect(validateTelemetryBatchParallel(bigArray)).rejects.toThrow("cannot exceed 100 items");
    });
  });

  describe("2. Timestamp Validation Before Date Conversion", () => {
    it("validates isValidTimestampValue helper function correctly", () => {
      // Valid cases
      expect(isValidTimestampValue(undefined).valid).toBe(true);
      expect(isValidTimestampValue(null).valid).toBe(true);
      expect(isValidTimestampValue(1600000000000).valid).toBe(true);
      expect(isValidTimestampValue(1600000000).valid).toBe(true); // seconds epoch
      expect(isValidTimestampValue("2026-11-25T12:00:00Z").valid).toBe(true);
      expect(isValidTimestampValue(new Date("2026-11-25T12:00:00Z")).valid).toBe(true);

      // Invalid cases
      expect(isValidTimestampValue(NaN).valid).toBe(false);
      expect(isValidTimestampValue(Infinity).valid).toBe(false);
      expect(isValidTimestampValue(-Infinity).valid).toBe(false);
      expect(isValidTimestampValue("not-a-date").valid).toBe(false);
      expect(isValidTimestampValue("NaN").valid).toBe(false);
      expect(isValidTimestampValue(new Date("invalid")).valid).toBe(false);
      expect(isValidTimestampValue(true).valid).toBe(false);
      expect(isValidTimestampValue({}).valid).toBe(false);
      expect(isValidTimestampValue([]).valid).toBe(false);

      // Out of bounds cases (< 2000 or > 2100)
      expect(isValidTimestampValue(1000).valid).toBe(false); // seconds: 1970
      expect(isValidTimestampValue(5000000000000).valid).toBe(false); // year 2128
    });

    it("rejects invalid date strings, NaN, and non-finite timestamps in batch with 400", async () => {
      const invalidTimestampBatches = [
        [{ venueId: "v1", value: 10, timestamp: "invalid-date-string" }],
        [{ venueId: "v1", value: 10, timestamp: "NaN" }],
        [{ venueId: "v1", value: 10, recordedAt: "unknown" }],
        [{ venueId: "v1", value: 10, timestamp: 9999999999999 }], // Out of supported bounds (year > 2100)
        [{ venueId: "v1", value: 10, timestamp: 1000 }], // Out of supported bounds (year 1970)
      ];

      for (const batch of invalidTimestampBatches) {
        const req = createRequest({ readings: batch });
        const res = await POST(req);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe("Validation failed");
        expect(Array.isArray(json.details)).toBe(true);
        expect(json.details[0].errors).toBeDefined();
      }

      expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
    });

    it("ensures entire batch fails atomically if any item has an invalid timestamp (no partial writes)", async () => {
      const mixedBatch = [
        { venueId: "v1", value: 10, timestamp: "2026-11-25T10:00:00Z" }, // valid
        { venueId: "v2", value: 20, timestamp: "corrupted-date-xyz" }, // invalid
        { venueId: "v3", value: 30, timestamp: 1700000000000 }, // valid
      ];

      const req = createRequest({ readings: mixedBatch });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Validation failed");
      expect(json.details).toHaveLength(1);
      expect(json.details[0].index).toBe(1);

      // Verify zero database writes occurred
      expect((prisma as any).venueTelemetry.createMany).not.toHaveBeenCalled();
    });

    it("accepts boundary timestamps (min: 2000-01-01, max: 2100-01-01) and valid ISO strings", async () => {
      const validBoundaryBatch = [
        { venueId: "v-min", value: 10, timestamp: MIN_TIMESTAMP_MS },
        { venueId: "v-max", value: 20, recordedAt: MAX_TIMESTAMP_MS },
        { venueId: "v-iso", value: 30, timestamp: "2026-11-25T12:00:00.000Z" },
        { venueId: "v-now", value: 40 }, // optional timestamp defaults safely
      ];

      (prisma as any).venueTelemetry.createMany.mockResolvedValue({ count: 4 });

      const req = createRequest({ readings: validBoundaryBatch });
      const res = await POST(req);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.count).toBe(4);

      expect((prisma as any).venueTelemetry.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            venueId: "v-min",
            recordedAt: new Date(MIN_TIMESTAMP_MS),
          }),
          expect.objectContaining({
            venueId: "v-max",
            recordedAt: new Date(MAX_TIMESTAMP_MS),
          }),
        ]),
        skipDuplicates: true,
      });
    });
  });
});
