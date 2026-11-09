/**
 * Regression tests for the calendar-day handling in nomadTaxEngine:
 * - calculateSchengenStay must use a window of exactly 180 whole calendar days
 *   ending on the reference day, independent of the time of day / server time zone.
 * - generateNomadComplianceReport must bucket records into tax years by the
 *   calendar date they were written with, independent of the server time zone.
 */

import {
  calculateSchengenStay,
  generateNomadComplianceReport,
  type NomadCheckInRecord,
} from "@/lib/tax/nomadTaxEngine";

function record(
  date: string,
  overrides: Partial<NomadCheckInRecord> = {},
): NomadCheckInRecord {
  return {
    id: `rec-${date}`,
    venueId: "venue-1",
    venueName: "Test Venue",
    city: "Berlin",
    country: "Germany",
    countryCode: "DE",
    isSchengen: true,
    date,
    amountSpent: 100,
    currency: "USD",
    vatRatePct: 19,
    ...overrides,
  };
}

/** One Schengen record for every day from `from` to `to` (inclusive, "YYYY-MM-DD"). */
function everyDay(from: string, to: string): NomadCheckInRecord[] {
  const out: NomadCheckInRecord[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    out.push(record(new Date(t).toISOString().slice(0, 10)));
  }
  return out;
}

describe("calculateSchengenStay rolling 180-day window", () => {
  // Present in Schengen every single day, so any correct 180-day window holds 180 days.
  const continuousStay = everyDay("2026-01-01", "2027-03-31");

  // Includes the exact top of every hour (00:00:00.000 is where a time-of-day
  // dependent window used to count a 181st day) and the last millisecond of the day.
  const referenceInstants = [
    ...Array.from({ length: 24 }, (_, hour) =>
      Date.UTC(2026, 9, 13, hour, 0, 0, 0),
    ),
    Date.UTC(2026, 9, 13, 12, 30, 0, 0),
    Date.UTC(2026, 9, 13, 23, 59, 59, 999),
  ];

  it.each(referenceInstants)(
    "counts exactly 180 days no matter the time of day (%i)",
    (instant) => {
      expect(
        calculateSchengenStay(continuousStay, new Date(instant)).daysUsed,
      ).toBe(180);
    },
  );

  it("includes the reference day and the 179 days before it, but not the 180th", () => {
    const reference = new Date("2026-10-13T12:00:00Z");

    // 2026-10-13 minus 179 days is 2026-04-17; 2026-04-16 is already outside.
    const inside = calculateSchengenStay([record("2026-04-17")], reference);
    const outside = calculateSchengenStay([record("2026-04-16")], reference);
    const today = calculateSchengenStay([record("2026-10-13")], reference);

    expect(inside.daysUsed).toBe(1);
    expect(outside.daysUsed).toBe(0);
    expect(today.daysUsed).toBe(1);
  });

  it("never counts the day that is 180 days back, even at exactly 00:00 UTC", () => {
    const midnight = new Date("2026-10-13T00:00:00Z");
    expect(
      calculateSchengenStay([record("2026-04-16")], midnight).daysUsed,
    ).toBe(0);
  });

  it("does not count future-dated stays", () => {
    const reference = new Date("2026-10-13T12:00:00Z");
    expect(
      calculateSchengenStay([record("2026-10-14")], reference).daysUsed,
    ).toBe(0);
  });

  it("accepts a plain YYYY-MM-DD reference day", () => {
    expect(calculateSchengenStay(continuousStay, "2026-10-13").daysUsed).toBe(
      180,
    );
  });

  it("evaluates 'today' in the traveller's time zone when one is given", () => {
    // 23:30 UTC on 13 Oct is already 01:30 on 14 Oct in Berlin (CEST).
    const instant = new Date("2026-10-13T23:30:00Z");
    const stays = [record("2026-10-14")];

    expect(
      calculateSchengenStay(stays, instant, { timeZone: "Europe/Berlin" })
        .daysUsed,
    ).toBe(1);
    expect(calculateSchengenStay(stays, instant).daysUsed).toBe(0);
  });

  it("counts a calendar day once even if it has several check-ins", () => {
    const reference = new Date("2026-10-13T12:00:00Z");
    const stays = [
      record("2026-10-10"),
      record("2026-10-10"),
      record("2026-10-11"),
    ];
    expect(calculateSchengenStay(stays, reference).daysUsed).toBe(2);
  });

  it("ignores non-Schengen stays and recognises Schengen countries by code", () => {
    const reference = new Date("2026-10-13T12:00:00Z");
    const stays = [
      record("2026-10-10", { countryCode: "JP", isSchengen: false }),
      record("2026-10-11", { countryCode: "ES", isSchengen: false }),
    ];
    expect(calculateSchengenStay(stays, reference).daysUsed).toBe(1);
  });

  it("ignores records whose date is not a real calendar date", () => {
    const reference = new Date("2026-10-13T12:00:00Z");
    const stays = [
      record("not-a-date"),
      record("2026-02-30"),
      record(""),
      record("2026-10-12"),
    ];
    expect(calculateSchengenStay(stays, reference).daysUsed).toBe(1);
  });

  it("reports remaining days and status from the 90-day limit", () => {
    const reference = new Date("2026-10-13T12:00:00Z");
    const result = calculateSchengenStay(
      everyDay("2026-07-26", "2026-10-13"),
      reference,
    );

    expect(result.daysUsed).toBe(80);
    expect(result.daysRemaining).toBe(10);
    expect(result.status).toBe("CRITICAL_LIMIT");
    expect(result.maxDays).toBe(90);
    expect(result.windowDays).toBe(180);
  });

  it("throws for an invalid reference date instead of silently returning 0", () => {
    expect(() => calculateSchengenStay([], "garbage")).toThrow(
      /Invalid reference date/,
    );
  });
});

describe("generateNomadComplianceReport tax-year bucketing", () => {
  const records = [
    record("2026-01-01", { countryCode: "PT", country: "Portugal" }),
    record("2026-06-15", { countryCode: "PT", country: "Portugal" }),
    record("2026-12-31", { countryCode: "PT", country: "Portugal" }),
    record("2025-12-31", { countryCode: "PT", country: "Portugal" }),
    record("2027-01-01", { countryCode: "PT", country: "Portugal" }),
  ];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("counts every record dated inside the tax year, including 1 Jan and 31 Dec", () => {
    const portugal = generateNomadComplianceReport(
      records,
      2026,
    ).countryBreakdown.find((c) => c.countryCode === "PT");

    expect(portugal?.daysSpent).toBe(3);
    expect(portugal?.totalSpent).toBe(300);
  });

  it("is not affected by a server running behind UTC (UTC-5)", () => {
    // Emulate a UTC-5 server: getFullYear() reports the *local* year of an instant.
    // Only in-year records here, so a wrongly dropped 1 Jan cannot be masked by a
    // wrongly admitted record from another year.
    jest.spyOn(Date.prototype, "getFullYear").mockImplementation(function (
      this: Date,
    ) {
      return new Date(this.getTime() - 5 * 3_600_000).getUTCFullYear();
    });

    const inYear = records.filter((r) => r.date.startsWith("2026"));
    const portugal = generateNomadComplianceReport(
      inYear,
      2026,
    ).countryBreakdown.find((c) => c.countryCode === "PT");

    expect(portugal?.daysSpent).toBe(3);
    expect(portugal?.totalSpent).toBe(300);
  });

  it("excludes records from other years and invalid dates", () => {
    const report = generateNomadComplianceReport(
      [record("2025-12-31"), record("2027-01-01"), record("nope")],
      2026,
    );
    expect(report.countryBreakdown).toEqual([]);
    expect(report.totalWorkspaceExpense).toBe(0);
  });
});
