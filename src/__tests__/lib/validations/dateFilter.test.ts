import {
  createDateFilterSchema,
  dateFilterSchema,
  parseDateFilter,
} from "@/lib/validations/dateFilter";

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
