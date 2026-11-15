import {
  BookingEngine,
  globalBookingEngine,
} from "@/lib/booking/bookingEngine";
import {
  normalizeBookingTime,
  parseBookingStart,
  parseBookingDateTime,
} from "@/lib/booking/dateTimeAdapter";

describe("BookingEngine & Domain Schedule Validation (#6730)", () => {
  const engine = new BookingEngine();

  describe("normalizeBookingTime", () => {
    it("normalizes midnight and end-of-day times", () => {
      expect(normalizeBookingTime("24:00")).toBe("24:00");
      expect(normalizeBookingTime("00:00")).toBe("00:00");
      expect(normalizeBookingTime("12:00 AM")).toBe("00:00");
      expect(normalizeBookingTime("12:00 PM")).toBe("12:00");
    });

    it("normalizes standard 12h and 24h times", () => {
      expect(normalizeBookingTime("9:05")).toBe("09:05");
      expect(normalizeBookingTime("9:05 AM")).toBe("09:05");
      expect(normalizeBookingTime("5:30 PM")).toBe("17:30");
      expect(normalizeBookingTime("23:59")).toBe("23:59");
    });

    it("rejects invalid time strings", () => {
      expect(normalizeBookingTime("24:01")).toBeNull();
      expect(normalizeBookingTime("25:00")).toBeNull();
      expect(normalizeBookingTime("invalid")).toBeNull();
      expect(normalizeBookingTime("")).toBeNull();
    });
  });

  describe("calculateAvailableSlots", () => {
    const testDate = "2026-10-30";
    const futureNow = new Date("2026-10-01T00:00:00.000Z");

    it("calculates slots across a continuous 24-hour schedule (00:00 - 24:00)", () => {
      const slots = engine.calculateAvailableSlots({
        date: testDate,
        openingTime: "00:00",
        closingTime: "24:00",
        slotDurationMinutes: 60,
        now: futureNow,
      });

      expect(slots).toHaveLength(24);
      expect(slots[0].time).toBe("00:00");
      expect(slots[0].endTime).toBe("01:00");
      expect(slots[23].time).toBe("23:00");
      expect(slots[23].endTime).toBe("24:00");
      expect(slots.every((s) => s.available)).toBe(true);
    });

    it("calculates slots across a continuous 24-hour schedule (00:00 - 00:00 representation)", () => {
      const slots = engine.calculateAvailableSlots({
        date: testDate,
        openingTime: "00:00",
        closingTime: "00:00",
        slotDurationMinutes: 120,
        now: futureNow,
      });

      expect(slots).toHaveLength(12);
      expect(slots[0].time).toBe("00:00");
      expect(slots[0].endTime).toBe("02:00");
      expect(slots[11].time).toBe("22:00");
      expect(slots[11].endTime).toBe("24:00");
    });

    it("returns empty slots when venue is marked closed", () => {
      const slots = engine.calculateAvailableSlots({
        date: testDate,
        isClosed: true,
        openingTime: "08:00",
        closingTime: "20:00",
      });

      expect(slots).toEqual([]);
    });

    it("generates slots within standard daytime operating hours (08:00 - 12:00)", () => {
      const slots = engine.calculateAvailableSlots({
        date: testDate,
        openingTime: "08:00",
        closingTime: "12:00",
        slotDurationMinutes: 60,
        now: futureNow,
      });

      expect(slots).toHaveLength(4);
      expect(slots.map((s) => s.time)).toEqual([
        "08:00",
        "09:00",
        "10:00",
        "11:00",
      ]);
    });
  });

  describe("validateBookingWindow", () => {
    const testDate = "2026-10-30";
    const futureNow = new Date("2026-10-01T00:00:00.000Z");

    it("accepts bookings at any hour for 24-hour venues (00:00 - 24:00)", () => {
      const lateNight = engine.validateBookingWindow({
        date: testDate,
        time: "02:00",
        duration: 60,
        openingTime: "00:00",
        closingTime: "24:00",
        now: futureNow,
      });
      expect(lateNight.valid).toBe(true);
      expect(lateNight.errors).toHaveLength(0);

      const evening = engine.validateBookingWindow({
        date: testDate,
        time: "22:00",
        duration: 120,
        openingTime: "00:00",
        closingTime: "24:00",
        now: futureNow,
      });
      expect(evening.valid).toBe(true);
      expect(evening.errors).toHaveLength(0);
    });

    it("accepts bookings for 24-hour venues represented as 00:00 - 00:00", () => {
      const result = engine.validateBookingWindow({
        date: testDate,
        time: "14:00",
        duration: 60,
        openingTime: "00:00",
        closingTime: "00:00",
        now: futureNow,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects bookings that exceed standard closing hours", () => {
      const result = engine.validateBookingWindow({
        date: testDate,
        time: "17:30",
        duration: 60,
        openingTime: "09:00",
        closingTime: "18:00",
        now: futureNow,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("operating hours");
    });
  });

  describe("evaluateCancellationEligibility with local time", () => {
    it("correctly evaluates cancellation without timezone using local date convention", () => {
      const testNow = new Date(2026, 6, 23, 10, 0, 0, 0);

      // 2 hours exactly
      const exactlyTwoHours = globalBookingEngine.evaluateCancellationEligibility({
        date: "2026-07-23",
        time: "12:00",
        now: testNow,
      });
      expect(exactlyTwoHours.allowed).toBe(true);

      // Less than 2 hours
      const insideWindow = globalBookingEngine.evaluateCancellationEligibility({
        date: "2026-07-23",
        time: "11:30",
        now: testNow,
      });
      expect(insideWindow.allowed).toBe(false);
      expect(insideWindow.reason).toBe("INSIDE_WINDOW");
    });
  });
  describe("Defensive hardening & edge-case safety (#6762)", () => {
    it("handles nullish and invalid params in calculateAvailableSlots safely", () => {
      // @ts-expect-error testing null input
      expect(engine.calculateAvailableSlots(null)).toEqual([]);
      // @ts-expect-error testing undefined input
      expect(engine.calculateAvailableSlots(undefined)).toEqual([]);

      // Non-positive or NaN duration should not hang in infinite loop
      expect(
        engine.calculateAvailableSlots({
          date: "2026-10-30",
          slotDurationMinutes: 0,
        }),
      ).toEqual([]);
      expect(
        engine.calculateAvailableSlots({
          date: "2026-10-30",
          slotDurationMinutes: -15,
        }),
      ).toEqual([]);
      expect(
        engine.calculateAvailableSlots({
          date: "2026-10-30",
          // @ts-expect-error testing NaN
          slotDurationMinutes: NaN,
        }),
      ).toEqual([]);

      // Corrupt elements in existingBookings and nullish seatIds
      const slots = engine.calculateAvailableSlots({
        date: "2026-10-30",
        openingTime: "08:00",
        closingTime: "09:00",
        slotDurationMinutes: 60,
        // @ts-expect-error testing null in array
        existingBookings: [null, undefined, { date: "2026-10-30", time: "08:00", duration: 60, seatId: "s1" }],
        // @ts-expect-error testing invalid seatIds
        seatIds: [null, "s1", "s2"],
        now: new Date("2026-10-01T00:00:00.000Z"),
      });

      expect(slots).toHaveLength(1);
      expect(slots[0].availableSeatIds).toEqual(["s2"]);
      expect(slots[0].bookedSeatsCount).toBe(1);
    });

    it("handles nullish params and non-finite duration in validateBookingWindow safely", () => {
      // @ts-expect-error testing null input
      const nullRes = engine.validateBookingWindow(null);
      expect(nullRes.valid).toBe(false);
      expect(nullRes.errors[0]).toContain("parameters object is required");

      // Non-finite duration (NaN or string)
      const nanRes = engine.validateBookingWindow({
        date: "2026-10-30",
        time: "10:00",
        // @ts-expect-error testing NaN duration
        duration: NaN,
      });
      expect(nanRes.valid).toBe(false);
      expect(nanRes.errors).toContain(
        "Booking duration must be a positive finite number.",
      );

      // Negative duration
      const negRes = engine.validateBookingWindow({
        date: "2026-10-30",
        time: "10:00",
        duration: -30,
      });
      expect(negRes.valid).toBe(false);
      expect(negRes.errors).toContain(
        "Booking duration must be a positive finite number.",
      );
    });

    it("handles nullish existingBookings and corrupt items in checkConflicts", () => {
      // @ts-expect-error testing null params
      expect(() => engine.checkConflicts(null)).toThrow("params object is required");

      const res = engine.checkConflicts({
        requestedSlot: { date: "2026-10-30", time: "10:00", duration: 60 },
        // @ts-expect-error testing null existingBookings
        existingBookings: null,
      });
      expect(res.hasConflict).toBe(false);
      expect(res.conflictingBookings).toEqual([]);

      // Array containing nullish items
      const corruptRes = engine.checkConflicts({
        requestedSlot: { date: "2026-10-30", time: "10:00", duration: 60 },
        // @ts-expect-error testing corrupt array
        existingBookings: [null, undefined, { date: "2026-10-30", time: "10:00", duration: 60 }],
      });
      expect(corruptRes.hasConflict).toBe(true);
      expect(corruptRes.conflictingBookings).toHaveLength(1);
    });

    it("handles nullish params and negative/NaN radius in getConflictDateWindow safely", () => {
      // Negative radius falls back to default
      const defaultWin = engine.getConflictDateWindow("2026-10-10");
      const negWin = engine.getConflictDateWindow("2026-10-10", -1);
      const nanWin = engine.getConflictDateWindow("2026-10-10", NaN);
      expect(negWin).toEqual(defaultWin);
      expect(nanWin).toEqual(defaultWin);
    });

    it("handles nullish params in evaluateCancellationEligibility safely", () => {
      // @ts-expect-error testing null input
      const nullRes = engine.evaluateCancellationEligibility(null);
      expect(nullRes.allowed).toBe(false);
      expect(nullRes.reason).toBe("INVALID_START_TIME");
    });
  });
});
