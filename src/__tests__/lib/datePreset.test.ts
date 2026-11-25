import {
  getDatePreset,
  formatLocalDate,
} from "@/lib/validations/dateFilter";

describe("Date Preset Calculation (Issue #9608 & #9885)", () => {
  describe("formatLocalDate", () => {
    it("formats local date components as YYYY-MM-DD", () => {
      const d = new Date(2026, 10, 23); // Nov 23, 2026
      expect(formatLocalDate(d)).toBe("2026-11-23");
    });

    it("pads single digit months and days", () => {
      const d = new Date(2026, 0, 5); // Jan 5, 2026
      expect(formatLocalDate(d)).toBe("2026-01-05");
    });
  });

  describe("Today preset", () => {
    it("returns start and end date matching the current local date", () => {
      const ref = new Date(2026, 4, 15); // May 15, 2026
      const result = getDatePreset("today", ref);
      expect(result).toEqual({
        startDate: "2026-05-15",
        endDate: "2026-05-15",
      });
    });
  });

  describe("Tomorrow preset", () => {
    it("returns start and end date matching the next calendar day", () => {
      const ref = new Date(2026, 4, 15); // May 15, 2026
      const result = getDatePreset("tomorrow", ref);
      expect(result).toEqual({
        startDate: "2026-05-16",
        endDate: "2026-05-16",
      });
    });

    it("handles month boundary transitions", () => {
      const ref = new Date(2026, 0, 31); // Jan 31, 2026
      const result = getDatePreset("tomorrow", ref);
      expect(result).toEqual({
        startDate: "2026-02-01",
        endDate: "2026-02-01",
      });
    });

    it("handles leap year February boundary transitions", () => {
      const leapRef = new Date(2028, 1, 28); // Feb 28, 2028 (leap year)
      expect(getDatePreset("tomorrow", leapRef)).toEqual({
        startDate: "2028-02-29",
        endDate: "2028-02-29",
      });

      const nonLeapRef = new Date(2026, 1, 28); // Feb 28, 2026
      expect(getDatePreset("tomorrow", nonLeapRef)).toEqual({
        startDate: "2026-03-01",
        endDate: "2026-03-01",
      });
    });

    it("handles year boundary transitions", () => {
      const ref = new Date(2026, 11, 31); // Dec 31, 2026
      const result = getDatePreset("tomorrow", ref);
      expect(result).toEqual({
        startDate: "2027-01-01",
        endDate: "2027-01-01",
      });
    });
  });

  describe("This Weekend preset", () => {
    it("calculates upcoming Saturday and Sunday when today is Wednesday (weekday)", () => {
      // Nov 18, 2026 is Wednesday
      const ref = new Date(2026, 10, 18);
      expect(ref.getDay()).toBe(3); // Wednesday

      const result = getDatePreset("weekend", ref);
      expect(result).toEqual({
        startDate: "2026-11-21", // Saturday
        endDate: "2026-11-22", // Sunday
      });
    });

    it("calculates upcoming Saturday and Sunday when today is Monday", () => {
      // Nov 16, 2026 is Monday
      const ref = new Date(2026, 10, 16);
      expect(ref.getDay()).toBe(1);

      const result = getDatePreset("weekend", ref);
      expect(result).toEqual({
        startDate: "2026-11-21",
        endDate: "2026-11-22",
      });
    });

    it("calculates upcoming Saturday and Sunday when today is Friday", () => {
      // Nov 20, 2026 is Friday
      const ref = new Date(2026, 10, 20);
      expect(ref.getDay()).toBe(5);

      const result = getDatePreset("weekend", ref);
      expect(result).toEqual({
        startDate: "2026-11-21",
        endDate: "2026-11-22",
      });
    });

    it("returns current weekend when today is Saturday", () => {
      // Nov 21, 2026 is Saturday
      const ref = new Date(2026, 10, 21);
      expect(ref.getDay()).toBe(6);

      const result = getDatePreset("weekend", ref);
      expect(result).toEqual({
        startDate: "2026-11-21", // Today (Saturday)
        endDate: "2026-11-22", // Tomorrow (Sunday)
      });
    });

    it("returns current weekend when today is Sunday", () => {
      // Nov 22, 2026 is Sunday
      const ref = new Date(2026, 10, 22);
      expect(ref.getDay()).toBe(0);

      const result = getDatePreset("weekend", ref);
      expect(result).toEqual({
        startDate: "2026-11-21", // Yesterday (Saturday)
        endDate: "2026-11-22", // Today (Sunday)
      });
    });

    it("handles month boundary during weekend span (Sat in month M, Sun in month M+1)", () => {
      // Oct 31, 2026 is Saturday
      const ref = new Date(2026, 9, 28); // Oct 28, 2026 (Wednesday)
      const result = getDatePreset("weekend", ref);
      expect(result).toEqual({
        startDate: "2026-10-31", // Saturday
        endDate: "2026-11-01", // Sunday
      });
    });

    it("handles year boundary during weekend span", () => {
      // Dec 31, 2026 is Thursday -> Upcoming Saturday is Jan 2, 2027
      const ref = new Date(2026, 11, 31);
      expect(ref.getDay()).toBe(4); // Thursday

      const result = getDatePreset("weekend", ref);
      expect(result).toEqual({
        startDate: "2027-01-02", // Saturday
        endDate: "2027-01-03", // Sunday
      });
    });
  });

  describe("Next Monday preset (#9885)", () => {
    it("calculates immediately following Monday when today is Sunday (day 0 -> +1 day)", () => {
      // Nov 22, 2026 is Sunday
      const ref = new Date(2026, 10, 22);
      expect(ref.getDay()).toBe(0);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2026-11-23",
        endDate: "2026-11-23",
      });
    });

    it("calculates following week's Monday when today is Monday (day 1 -> +7 days)", () => {
      // Nov 23, 2026 is Monday
      const ref = new Date(2026, 10, 23);
      expect(ref.getDay()).toBe(1);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2026-11-30",
        endDate: "2026-11-30",
      });
    });

    it("calculates upcoming Monday when today is Tuesday (day 2 -> +6 days)", () => {
      const ref = new Date(2026, 10, 24);
      expect(ref.getDay()).toBe(2);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2026-11-30",
        endDate: "2026-11-30",
      });
    });

    it("calculates upcoming Monday when today is Wednesday (day 3 -> +5 days)", () => {
      const ref = new Date(2026, 10, 25);
      expect(ref.getDay()).toBe(3);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2026-11-30",
        endDate: "2026-11-30",
      });
    });

    it("calculates upcoming Monday when today is Thursday (day 4 -> +4 days)", () => {
      const ref = new Date(2026, 10, 26);
      expect(ref.getDay()).toBe(4);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2026-11-30",
        endDate: "2026-11-30",
      });
    });

    it("calculates upcoming Monday when today is Friday (day 5 -> +3 days)", () => {
      const ref = new Date(2026, 10, 27);
      expect(ref.getDay()).toBe(5);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2026-11-30",
        endDate: "2026-11-30",
      });
    });

    it("calculates upcoming Monday when today is Saturday (day 6 -> +2 days)", () => {
      const ref = new Date(2026, 10, 28);
      expect(ref.getDay()).toBe(6);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2026-11-30",
        endDate: "2026-11-30",
      });
    });

    it("handles month boundary transitions", () => {
      // May 30, 2026 is Saturday -> Next Monday is June 1, 2026
      const ref = new Date(2026, 4, 30);
      expect(ref.getDay()).toBe(6);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2026-06-01",
        endDate: "2026-06-01",
      });
    });

    it("handles year boundary transitions (December to January)", () => {
      // Dec 30, 2026 is Wednesday -> Next Monday is Jan 4, 2027
      const ref = new Date(2026, 11, 30);
      expect(ref.getDay()).toBe(3);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2027-01-04",
        endDate: "2027-01-04",
      });
    });

    it("handles leap year February boundary transitions", () => {
      // Feb 26, 2028 is Saturday -> Next Monday is Feb 28, 2028 (leap year)
      const ref = new Date(2028, 1, 26);
      expect(ref.getDay()).toBe(6);

      const result = getDatePreset("nextMonday", ref);
      expect(result).toEqual({
        startDate: "2028-02-28",
        endDate: "2028-02-28",
      });
    });
  });
});
