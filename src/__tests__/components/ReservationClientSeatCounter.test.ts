import {
  clampSeatCount,
  decrementSeatCount,
  incrementSeatCount,
} from "@/app/reserve/[venueId]/reservation-client";

describe("ReservationClient Seat Counter Bounds & Clamping", () => {
  describe("clampSeatCount", () => {
    it("returns 0 when available capacity is 0", () => {
      expect(clampSeatCount(1, 0)).toBe(0);
      expect(clampSeatCount(5, 0)).toBe(0);
      expect(clampSeatCount(-1, 0)).toBe(0);
    });

    it("returns 0 when capacity is negative", () => {
      expect(clampSeatCount(1, -5)).toBe(0);
    });

    it("clamps minimum seat count to 1 when capacity > 0", () => {
      expect(clampSeatCount(0, 10)).toBe(1);
      expect(clampSeatCount(-3, 10)).toBe(1);
    });

    it("clamps maximum seat count to available capacity", () => {
      expect(clampSeatCount(15, 10)).toBe(10);
      expect(clampSeatCount(100, 4)).toBe(4);
    });

    it("retains count when within [1, capacity] bounds", () => {
      expect(clampSeatCount(1, 10)).toBe(1);
      expect(clampSeatCount(5, 10)).toBe(5);
      expect(clampSeatCount(10, 10)).toBe(10);
    });
  });

  describe("decrementSeatCount", () => {
    it("returns 0 and prevents negative numbers when capacity is 0", () => {
      expect(decrementSeatCount(0, 0)).toBe(0);
      expect(decrementSeatCount(1, 0)).toBe(0);
      expect(decrementSeatCount(-1, 0)).toBe(0);
    });

    it("does not allow count to decrement below 1 when capacity is available", () => {
      expect(decrementSeatCount(1, 5)).toBe(1);
      expect(decrementSeatCount(1, 1)).toBe(1);
    });

    it("decrements count normally when above 1", () => {
      expect(decrementSeatCount(4, 5)).toBe(3);
      expect(decrementSeatCount(2, 5)).toBe(1);
    });
  });

  describe("incrementSeatCount", () => {
    it("returns 0 when capacity is 0", () => {
      expect(incrementSeatCount(0, 0)).toBe(0);
      expect(incrementSeatCount(1, 0)).toBe(0);
    });

    it("increments count normally below capacity", () => {
      expect(incrementSeatCount(1, 5)).toBe(2);
      expect(incrementSeatCount(4, 5)).toBe(5);
    });

    it("does not allow count to exceed available capacity", () => {
      expect(incrementSeatCount(5, 5)).toBe(5);
      expect(incrementSeatCount(10, 5)).toBe(5);
    });
  });
});
