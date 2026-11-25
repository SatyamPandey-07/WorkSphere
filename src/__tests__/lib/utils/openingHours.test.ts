import {
  formatRemainingTime,
  getVenueOpeningStatus,
  parseVenueOpeningHours,
} from "@/lib/utils/openingHours";

describe("openingHours utilities", () => {
  it("parses structured schedules and invalid schedules safely", () => {
    expect(
      parseVenueOpeningHours(
        JSON.stringify({
          timezone: "UTC",
          periods: {
            monday: { open: "09:00", close: "17:00", closed: false },
          },
        }),
      ),
    ).not.toBeNull();
    expect(parseVenueOpeningHours("Mon-Fri 9am-5pm")).toBeNull();
    expect(parseVenueOpeningHours(null)).toBeNull();
  });

  it("shows open, closing soon, and exact closing-threshold states", () => {
    const schedule = JSON.stringify({
      timezone: "UTC",
      periods: {
        monday: { open: "09:00", close: "17:00", closed: false },
      },
    });

    expect(
      getVenueOpeningStatus(
        schedule,
        new Date("2026-10-26T14:45:00Z"),
      ).kind,
    ).toBe("open");
    expect(
      getVenueOpeningStatus(
        schedule,
        new Date("2026-10-26T16:15:00Z"),
      ).kind,
    ).toBe("closing-soon");
    expect(
      getVenueOpeningStatus(
        schedule,
        new Date("2026-10-26T16:15:00Z"),
      ).remainingMinutes,
    ).toBe(45);
  });

  it("handles venues closing in 30 and 1 minute", () => {
    const schedule = JSON.stringify({
      timezone: "UTC",
      periods: {
        monday: { open: "09:00", close: "17:00", closed: false },
      },
    });
    expect(
      getVenueOpeningStatus(
        schedule,
        new Date("2026-10-26T16:30:00Z"),
      ).kind,
    ).toBe("closing-soon");
    expect(
      getVenueOpeningStatus(
        schedule,
        new Date("2026-10-26T16:59:00Z"),
      ).kind,
    ).toBe("closing-soon");
  });

  it("returns closed with later today or tomorrow opening", () => {
    const schedule = JSON.stringify({
      timezone: "UTC",
      periods: {
        monday: { open: "09:00", close: "17:00", closed: false },
        tuesday: { open: "10:00", close: "18:00", closed: false },
      },
    });

    const laterToday = getVenueOpeningStatus(
      schedule,
      new Date("2026-10-26T08:00:00Z"),
    );
    expect(laterToday.kind).toBe("closed");
    expect(laterToday.text).toContain("today");

    const afterClose = getVenueOpeningStatus(
      schedule,
      new Date("2026-10-26T18:00:00Z"),
    );
    expect(afterClose.kind).toBe("closed");
    expect(afterClose.text).toContain("tomorrow");
  });

  it("handles overnight hours and midnight transitions", () => {
    const schedule = JSON.stringify({
      timezone: "UTC",
      periods: {
        saturday: { open: "20:00", close: "04:00", closed: false },
        sunday: { open: "00:00", close: "00:00", closed: true },
      },
    });

    const beforeClose = getVenueOpeningStatus(
      schedule,
      new Date("2026-10-25T01:30:00Z"),
    );
    expect(beforeClose.kind).toBe("open");
    expect(beforeClose.closingTime).toBe("4 AM");

    const pastMidnight = getVenueOpeningStatus(
      schedule,
      new Date("2026-10-25T03:30:00Z"),
    );
    expect(pastMidnight.kind).toBe("closing-soon");
  });

  it("recognizes 24/7 and unavailable schedules", () => {
    expect(
      getVenueOpeningStatus("24/7", new Date("2026-10-26T12:00:00Z")).text,
    ).toBe("Open 24 hours");
    expect(
      getVenueOpeningStatus(null, new Date("2026-10-26T12:00:00Z")).kind,
    ).toBe("unavailable");
  });

  it("supports venue timezone instead of the user's timezone", () => {
    const schedule = JSON.stringify({
      timezone: "America/New_York",
      periods: {
        monday: { open: "09:00", close: "17:00", closed: false },
      },
    });
    const status = getVenueOpeningStatus(
      schedule,
      new Date("2026-10-26T14:00:00Z"),
    );
    expect(status.kind).toBe("open");
    expect(status.timezone).toBe("America/New_York");
  });

  it("formats remaining countdowns", () => {
    expect(formatRemainingTime(32)).toBe("32m");
    expect(formatRemainingTime(135)).toBe("2h 15m");
  });
});
