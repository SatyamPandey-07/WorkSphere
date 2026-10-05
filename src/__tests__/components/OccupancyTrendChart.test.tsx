import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  OccupancyTrendChart,
  calculateDayOfWeekOccupancy,
  getOccupancyColor,
  getOccupancyLabel,
  getMondayFirstIndex,
  BookingRecord,
} from "@/components/analytics/OccupancyTrendChart";

// Mock recharts components for jsdom
jest.mock("recharts", () => {
  const OriginalModule = jest.requireActual("recharts");
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }: any) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    BarChart: ({ children, data }: any) => (
      <div data-testid="bar-chart" data-points={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Bar: ({ children }: any) => <div data-testid="bar">{children}</div>,
    Cell: ({ fill }: any) => <div data-testid="cell" data-fill={fill} />,
    XAxis: () => <div data-testid="x-axis" />,
    YAxis: () => <div data-testid="y-axis" />,
    CartesianGrid: () => <div data-testid="cartesian-grid" />,
    Tooltip: () => <div data-testid="tooltip" />,
  };
});

describe("OccupancyTrendChart & calculateDayOfWeekOccupancy (#3954)", () => {
  describe("getMondayFirstIndex", () => {
    it("correctly maps JavaScript Sunday-first day indexes to Monday-first indexes", () => {
      // JS Sunday = 0 -> Monday-first index 6
      expect(getMondayFirstIndex(0)).toBe(6);
      // JS Monday = 1 -> Monday-first index 0
      expect(getMondayFirstIndex(1)).toBe(0);
      // JS Tuesday = 2 -> Monday-first index 1
      expect(getMondayFirstIndex(2)).toBe(1);
      // JS Saturday = 6 -> Monday-first index 5
      expect(getMondayFirstIndex(6)).toBe(5);
    });
  });

  describe("calculateDayOfWeekOccupancy", () => {
    it("returns 7 days initialized with 0% occupancy when bookings array is empty", () => {
      const results = calculateDayOfWeekOccupancy([], 50, 10, 4);
      expect(results).toHaveLength(7);
      expect(results[0].day).toBe("Monday");
      expect(results[0].shortDay).toBe("Mon");
      expect(results[6].day).toBe("Sunday");
      expect(results[6].shortDay).toBe("Sun");

      results.forEach((dayPoint) => {
        expect(dayPoint.occupancyPercent).toBe(0);
        expect(dayPoint.bookedHours).toBe(0);
        expect(dayPoint.bookingCount).toBe(0);
      });
    });

    it("correctly aggregates booking hours and computes percentage occupancy per day of week", () => {
      // 2026-10-05 is a Monday
      // 2026-10-06 is a Tuesday
      // 2026-10-07 is a Wednesday
      const testBookings: BookingRecord[] = [
        // Monday: 2 bookings of 60 mins each = 2 hours
        { date: "2026-10-05", duration: 60, status: "CONFIRMED" },
        { date: "2026-10-05", duration: 60, status: "CONFIRMED" },
        // Tuesday: 1 booking of 120 mins = 2 hours
        { date: "2026-10-06", duration: 120, status: "CONFIRMED" },
        // Wednesday: 1 cancelled booking should be ignored
        { date: "2026-10-07", duration: 180, status: "CANCELLED" },
      ];

      // Capacity: 10 seats, 5 operating hours, 1 week window -> 10 * 5 * 1 = 50 seat-hours
      const results = calculateDayOfWeekOccupancy(testBookings, 10, 5, 1);

      // Monday: 2 / 50 = 4%
      expect(results[0].day).toBe("Monday");
      expect(results[0].bookedHours).toBe(2);
      expect(results[0].bookingCount).toBe(2);
      expect(results[0].occupancyPercent).toBe(4);

      // Tuesday: 2 / 50 = 4%
      expect(results[1].day).toBe("Tuesday");
      expect(results[1].bookedHours).toBe(2);
      expect(results[1].bookingCount).toBe(1);
      expect(results[1].occupancyPercent).toBe(4);

      // Wednesday: Cancelled booking excluded -> 0%
      expect(results[2].day).toBe("Wednesday");
      expect(results[2].bookedHours).toBe(0);
      expect(results[2].bookingCount).toBe(0);
      expect(results[2].occupancyPercent).toBe(0);
    });

    it("clamps occupancy percentage to 100% when booked hours exceed nominal capacity", () => {
      // 2026-10-05 is a Monday
      const highBookings: BookingRecord[] = [
        { date: "2026-10-05", duration: 600, status: "CONFIRMED" }, // 10 hours
        { date: "2026-10-05", duration: 600, status: "CONFIRMED" }, // 10 hours
      ];

      // Capacity = 1 seat, 1 operating hour, 1 week -> 1 seat-hour total
      const results = calculateDayOfWeekOccupancy(highBookings, 1, 1, 1);
      expect(results[0].occupancyPercent).toBe(100);
    });

    it("handles bookings with missing duration by defaulting to 60 minutes", () => {
      // 2026-10-05 is a Monday
      const testBookings: BookingRecord[] = [
        { date: "2026-10-05" }, // no duration provided
      ];

      const results = calculateDayOfWeekOccupancy(testBookings, 10, 10, 1);
      expect(results[0].bookedHours).toBe(1);
      expect(results[0].bookingCount).toBe(1);
    });
  });

  describe("getOccupancyColor & getOccupancyLabel", () => {
    it("returns correct color brackets and labels", () => {
      // Low (<40%)
      expect(getOccupancyColor(20)).toBe("#10b981");
      expect(getOccupancyLabel(20)).toBe("Optimal Space");

      // Moderate (40% - 75%)
      expect(getOccupancyColor(40)).toBe("#f59e0b");
      expect(getOccupancyColor(65)).toBe("#f59e0b");
      expect(getOccupancyLabel(50)).toBe("Moderate");

      // High (>=75%)
      expect(getOccupancyColor(75)).toBe("#ef4444");
      expect(getOccupancyColor(90)).toBe("#ef4444");
      expect(getOccupancyLabel(80)).toBe("High Occupancy");
    });
  });

  describe("OccupancyTrendChart Component Rendering", () => {
    it("renders the chart container with accessibility attributes", () => {
      const mockData = calculateDayOfWeekOccupancy([], 50, 10, 4);

      render(
        <OccupancyTrendChart
          data={mockData}
          title="Custom Monthly Occupancy"
        />
      );

      const region = screen.getByRole("region", {
        name: /monthly average seat occupancy chart by day of week/i,
      });
      expect(region).toBeInTheDocument();
      expect(screen.getByText("Custom Monthly Occupancy")).toBeInTheDocument();

      // Check screen reader table caption
      expect(
        screen.getByText("Monthly average seat occupancy per day of week")
      ).toBeInTheDocument();
    });

    it("renders day labels in the accessible data table", () => {
      const mockBookings: BookingRecord[] = [
        { date: "2026-10-05", duration: 120, status: "CONFIRMED" },
      ];

      render(
        <OccupancyTrendChart
          bookings={mockBookings}
          venueCapacity={20}
        />
      );

      expect(screen.getByRole("columnheader", { name: "Day" })).toBeInTheDocument();
      expect(screen.getByRole("rowheader", { name: "Monday" })).toBeInTheDocument();
      expect(screen.getByRole("rowheader", { name: "Sunday" })).toBeInTheDocument();
    });
  });
});
