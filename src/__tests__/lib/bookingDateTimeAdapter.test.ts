import {
  parseBookingDateTime,
  formatToWallClock,
  bookingInterval,
} from "@/lib/booking/dateTimeAdapter";

describe("DateTimeAdapter - DST Transitions and Round-Trip Validation", () => {
  describe("DST Spring-Forward Gap Handling", () => {
    it("rejects nonexistent local wall-clock times in America/New_York (spring forward 02:00 -> 03:00)", () => {
      // On 2027-03-14, clocks jump from 02:00 EST to 03:00 EDT in America/New_York.
      // 02:30 local does not exist.
      const instant = parseBookingDateTime(
        "2027-03-14",
        "02:30",
        "America/New_York",
      );
      expect(instant).toBeNull();
    });

    it("rejects nonexistent local wall-clock times in Europe/London (spring forward 01:00 -> 02:00)", () => {
      // On 2027-03-28, clocks jump from 01:00 GMT to 02:00 BST in Europe/London.
      // 01:30 local does not exist.
      const instant = parseBookingDateTime(
        "2027-03-28",
        "01:30",
        "Europe/London",
      );
      expect(instant).toBeNull();
    });

    it("accepts valid times immediately before and after the spring-forward gap in America/New_York", () => {
      // 01:30 EST (UTC-5) -> 06:30 UTC
      const before = parseBookingDateTime(
        "2027-03-14",
        "01:30",
        "America/New_York",
      );
      expect(before).not.toBeNull();
      expect(before?.toISOString()).toBe("2027-03-14T06:30:00.000Z");
      expect(formatToWallClock(before!, "America/New_York")).toEqual({
        date: "2027-03-14",
        time: "01:30",
      });

      // 03:30 EDT (UTC-4) -> 07:30 UTC
      const after = parseBookingDateTime(
        "2027-03-14",
        "03:30",
        "America/New_York",
      );
      expect(after).not.toBeNull();
      expect(after?.toISOString()).toBe("2027-03-14T07:30:00.000Z");
      expect(formatToWallClock(after!, "America/New_York")).toEqual({
        date: "2027-03-14",
        time: "03:30",
      });
    });
  });

  describe("DST Fall-Back Ambiguity Handling", () => {
    it("resolves ambiguous times during the autumn fall-back transition to the earlier instant", () => {
      // On 2027-11-07, clocks fall back from 02:00 EDT (UTC-4) to 01:00 EST (UTC-5) in America/New_York.
      // 01:30 occurs twice. The resolution policy resolves to the first occurrence (05:30 UTC, EDT).
      const instant = parseBookingDateTime(
        "2027-11-07",
        "01:30",
        "America/New_York",
      );
      expect(instant).not.toBeNull();
      expect(instant?.toISOString()).toBe("2027-11-07T05:30:00.000Z");

      const wallClock = formatToWallClock(instant!, "America/New_York");
      expect(wallClock).toEqual({
        date: "2027-11-07",
        time: "01:30",
      });
    });

    it("resolves fall-back times in Europe/London cleanly", () => {
      // On 2027-10-31, clocks fall back from 02:00 BST (UTC+1) to 01:00 GMT (UTC+0) in Europe/London.
      // 01:30 occurs twice. Resolves to a valid instant that formats back to 01:30 wall-clock time.
      const instant = parseBookingDateTime(
        "2027-10-31",
        "01:30",
        "Europe/London",
      );
      expect(instant).not.toBeNull();
      expect(instant?.toISOString()).toBe("2027-10-31T01:30:00.000Z");

      const wallClock = formatToWallClock(instant!, "Europe/London");
      expect(wallClock).toEqual({
        date: "2027-10-31",
        time: "01:30",
      });
    });
  });

  describe("Non-DST and Multi-Timezone Consistency", () => {
    it("converts wall-clock times in Asia/Kolkata (no DST) accurately", () => {
      const instant = parseBookingDateTime(
        "2027-03-14",
        "14:30",
        "Asia/Kolkata",
      );
      expect(instant).not.toBeNull();
      // UTC+05:30 -> 14:30 IST is 09:00 UTC
      expect(instant?.toISOString()).toBe("2027-03-14T09:00:00.000Z");
      expect(formatToWallClock(instant!, "Asia/Kolkata")).toEqual({
        date: "2027-03-14",
        time: "14:30",
      });
    });

    it("returns null for invalid dates or times", () => {
      expect(
        parseBookingDateTime("2027-02-29", "10:00", "America/New_York"),
      ).toBeNull();
      expect(
        parseBookingDateTime("2027-03-14", "25:00", "America/New_York"),
      ).toBeNull();
      expect(
        parseBookingDateTime("invalid", "10:00", "America/New_York"),
      ).toBeNull();
    });

    it("returns null from bookingInterval when slot time falls in DST gap", () => {
      const slot = {
        date: "2027-03-14",
        time: "02:30",
        timeZone: "America/New_York",
        duration: 60,
      };
      const interval = bookingInterval(slot);
      expect(interval).toBeNull();
    });
  });
});
