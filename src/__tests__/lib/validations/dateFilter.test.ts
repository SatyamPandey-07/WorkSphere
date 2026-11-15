import { NextRequest } from "next/server";
import {
  createDateFilterSchema,
  dateFilterSchema,
  parseDateFilter,
  isValidIso8601,
  normalizeToUtcIso,
  iso8601TimestampSchema,
  bookingDateFilterSchema,
  createDateFilterErrorResponse,
  parseBookingDateFilter,
} from "@/lib/validations/dateFilter";
import { GET as getBookingHistory } from "@/app/api/bookings/history/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: jest.fn(),
    },
  },
}));

describe("dateFilterSchema & parseDateFilter", () => {
  it("accepts a valid chronological range where startDate < endDate", () => {
    const result = parseDateFilter({
      startDate: "2026-11-01T09:00:00.000Z",
      endDate: "2026-11-10T18:00:00.000Z",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate?.toISOString()).toBe(
        "2026-11-01T09:00:00.000Z",
      );
      expect(result.data.endDate?.toISOString()).toBe(
        "2026-11-10T18:00:00.000Z",
      );
    }
  });

  it("accepts identical timestamps (startDate === endDate)", () => {
    const identical = "2026-11-13T12:00:00.000Z";
    const parsed = dateFilterSchema.safeParse({
      startDate: identical,
      endDate: identical,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects inverted date ranges (startDate > endDate) with INVALID_DATE_RANGE", () => {
    const result = parseDateFilter({
      startDate: "2026-11-20T10:00:00.000Z",
      endDate: "2026-11-15T10:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("INVALID_DATE_RANGE");
      expect(result.message).toMatch(
        /startDate must be chronologically before or equal to endDate/i,
      );
    }
  });

  it("enforces optional maxRangeDays boundary conditions (exact 90 days vs 90 days + 1ms)", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const exact90Days = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
    const over90Days = new Date(exact90Days.getTime() + 1);

    const exactResult = parseDateFilter(
      { startDate: start, endDate: exact90Days },
      { maxRangeDays: 90 },
    );
    expect(exactResult.success).toBe(true);

    const exceededResult = parseDateFilter(
      { startDate: start, endDate: over90Days },
      { maxRangeDays: 90 },
    );
    expect(exceededResult.success).toBe(false);
    if (!exceededResult.success) {
      expect(exceededResult.code).toBe("INVALID_DATE_RANGE");
      expect(exceededResult.message).toMatch(/cannot exceed 90 days/i);
    }
  });

  it("allows open-ended ranges when only startDate or only endDate is provided", () => {
    const schema = createDateFilterSchema({ maxRangeDays: 90 });

    expect(
      schema.safeParse({ startDate: "2026-11-01T00:00:00.000Z" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ endDate: "2026-11-30T00:00:00.000Z" }).success,
    ).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("rejects malformed timestamp strings with INVALID_DATE_RANGE", () => {
    const result = parseDateFilter({
      startDate: "not-a-valid-date",
      endDate: "2026-11-15T10:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("INVALID_DATE_RANGE");
    }
  });
});

describe("DateFilter ISO 8601 Validation & Normalization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
    (ensureUserExists as unknown as jest.Mock).mockResolvedValue(undefined);
  });

  describe("isValidIso8601", () => {
    it("accepts valid calendar dates (YYYY-MM-DD)", () => {
      expect(isValidIso8601("2026-11-10")).toBe(true);
      expect(isValidIso8601("2024-02-29")).toBe(true); // Leap year
      expect(isValidIso8601("2000-01-01")).toBe(true);
    });

    it("accepts valid UTC timestamps", () => {
      expect(isValidIso8601("2026-11-10T14:30:00Z")).toBe(true);
      expect(isValidIso8601("2026-11-10T14:30:00.000Z")).toBe(true);
      expect(isValidIso8601("2026-11-10T00:00:00.123Z")).toBe(true);
    });

    it("accepts valid timezone offsets", () => {
      expect(isValidIso8601("2026-11-10T14:30:00+05:30")).toBe(true);
      expect(isValidIso8601("2026-11-10T14:30:00-08:00")).toBe(true);
      expect(isValidIso8601("2026-11-10T14:30:00+00:00")).toBe(true);
    });

    it("rejects non-ISO formats", () => {
      expect(isValidIso8601("11/10/2026")).toBe(false);
      expect(isValidIso8601("10-11-2026")).toBe(false);
      expect(isValidIso8601("2026.11.10")).toBe(false);
      expect(isValidIso8601("Nov 10, 2026")).toBe(false);
      expect(isValidIso8601("yesterday")).toBe(false);
      expect(isValidIso8601("")).toBe(false);
      expect(isValidIso8601("   ")).toBe(false);
      expect(isValidIso8601(null)).toBe(false);
      expect(isValidIso8601(undefined)).toBe(false);
      expect(isValidIso8601(123456789)).toBe(false);
    });

    it("rejects invalid calendar dates", () => {
      expect(isValidIso8601("2026-02-29")).toBe(false); // 2026 is not a leap year
      expect(isValidIso8601("2026-02-30")).toBe(false);
      expect(isValidIso8601("2026-13-01")).toBe(false); // Month 13
      expect(isValidIso8601("2026-00-10")).toBe(false); // Month 0
      expect(isValidIso8601("2026-04-31")).toBe(false); // April has 30 days
    });

    it("rejects invalid time components and timezone offsets", () => {
      expect(isValidIso8601("2026-11-10T25:00:00Z")).toBe(false);
      expect(isValidIso8601("2026-11-10T14:60:00Z")).toBe(false);
      expect(isValidIso8601("2026-11-10T14:30:60Z")).toBe(false);
      expect(isValidIso8601("2026-11-10T14:30:00+25:00")).toBe(false);
      expect(isValidIso8601("2026-11-10T14:30:00+05:65")).toBe(false);
    });
  });

  describe("normalizeToUtcIso", () => {
    it("normalizes date-only string to midnight UTC ISO string", () => {
      expect(normalizeToUtcIso("2026-11-10")).toBe("2026-11-10T00:00:00.000Z");
    });

    it("normalizes timestamp with positive timezone offset to UTC", () => {
      // 14:30 in UTC+5:30 is 09:00 UTC
      expect(normalizeToUtcIso("2026-11-10T14:30:00+05:30")).toBe(
        "2026-11-10T09:00:00.000Z",
      );
    });

    it("normalizes timestamp with negative timezone offset to UTC", () => {
      // 04:00 in UTC-8:00 is 12:00 UTC
      expect(normalizeToUtcIso("2026-11-10T04:00:00-08:00")).toBe(
        "2026-11-10T12:00:00.000Z",
      );
    });

    it("preserves exact UTC timestamps", () => {
      expect(normalizeToUtcIso("2026-11-10T18:45:30.123Z")).toBe(
        "2026-11-10T18:45:30.123Z",
      );
    });

    it("throws error for invalid ISO strings", () => {
      expect(() => normalizeToUtcIso("invalid")).toThrow();
    });
  });

  describe("Zod schemas", () => {
    it("iso8601TimestampSchema parses and normalizes valid timestamp", () => {
      const result = iso8601TimestampSchema.parse("2026-11-10T14:30:00+05:30");
      expect(result).toBe("2026-11-10T09:00:00.000Z");
    });

    it("iso8601TimestampSchema throws on invalid format", () => {
      expect(() => iso8601TimestampSchema.parse("invalid-date")).toThrow();
    });

    it("bookingDateFilterSchema validates chronological range", () => {
      const valid = bookingDateFilterSchema.safeParse({
        startDate: "2026-11-01",
        endDate: "2026-11-10",
      });
      expect(valid.success).toBe(true);

      const invalid = bookingDateFilterSchema.safeParse({
        startDate: "2026-11-15",
        endDate: "2026-11-10",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("createDateFilterErrorResponse", () => {
    it("returns structured 400 Bad Request response with field errors", async () => {
      const response = createDateFilterErrorResponse([
        {
          field: "startDate",
          issue: "startDate must be a valid ISO 8601 date string",
        },
      ]);

      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toContain(
        "application/problem+json",
      );

      const body = await response.json();
      expect(body.status).toBe(400);
      expect(body.title).toBe("Bad Request");
      expect(body.code).toBe("BAD_REQUEST");
      expect(body.errors).toEqual([
        {
          field: "startDate",
          issue: "startDate must be a valid ISO 8601 date string",
        },
      ]);
      expect(body.fieldErrors).toEqual([
        {
          field: "startDate",
          message: "startDate must be a valid ISO 8601 date string",
        },
      ]);
    });
  });

  describe("parseBookingDateFilter", () => {
    it("successfully parses valid date range from URLSearchParams", () => {
      const params = new URLSearchParams({
        startDate: "2026-11-01T00:00:00Z",
        endDate: "2026-11-10T23:59:59Z",
      });

      const result = parseBookingDateFilter(params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.startDateUtc).toBe("2026-11-01T00:00:00.000Z");
        expect(result.data.endDateUtc).toBe("2026-11-10T23:59:59.000Z");
      }
    });

    it("fails with structured 400 when startDate is malformed", () => {
      const params = new URLSearchParams({
        startDate: "not-a-date",
        endDate: "2026-11-10",
      });

      const result = parseBookingDateFilter(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toEqual([
          expect.objectContaining({
            field: "startDate",
            issue: expect.stringContaining(
              "startDate must be a valid ISO 8601",
            ),
          }),
        ]);
        expect(result.response.status).toBe(400);
      }
    });

    it("fails with structured 400 when startDate is chronologically after endDate", () => {
      const params = new URLSearchParams({
        startDate: "2026-11-20",
        endDate: "2026-11-10",
      });

      const result = parseBookingDateFilter(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toEqual([
          expect.objectContaining({
            field: "startDate",
            issue: "startDate must be before or equal to endDate",
          }),
        ]);
      }
    });
  });

  describe("Integration with GET /api/bookings/history", () => {
    it("returns 400 Bad Request when query has invalid startDate", async () => {
      const req = new NextRequest(
        "http://localhost/api/bookings/history?startDate=invalid-date",
      );
      const res = await getBookingHistory(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.status).toBe(400);
      expect(body.errors).toEqual([
        expect.objectContaining({
          field: "startDate",
        }),
      ]);
    });

    it("successfully applies normalized date filter when valid ISO dates are provided", async () => {
      (prisma.booking.findMany as jest.Mock).mockResolvedValueOnce([]);

      const req = new NextRequest(
        "http://localhost/api/bookings/history?startDate=2026-11-01T00:00:00Z&endDate=2026-11-10T23:59:59Z",
      );
      const res = await getBookingHistory(req);

      expect(res.status).toBe(200);
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: {
              gte: "2026-11-01",
              lte: "2026-11-10",
            },
          }),
        }),
      );
    });
  });
});
