import React from "react";
import { render, screen, act } from "@testing-library/react";
import { VenueHoursBadge } from "@/components/venues/VenueHoursBadge";
import {
  type VenueOpeningHours,
  formatCountdown,
  isSchedule24Seven,
  isWindow24Hours,
  getVenueOpeningStatus,
} from "@/lib/venues/hours";

describe("VenueHoursBadge & dynamic opening countdown", () => {
  const standardSchedule: VenueOpeningHours = {
    timeZone: "Asia/Kolkata",
    schedule: {
      mon: [{ open: "09:00", close: "20:00" }],
      tue: [{ open: "09:00", close: "20:00" }],
      wed: [{ open: "09:00", close: "20:00" }],
      thu: [{ open: "09:00", close: "20:00" }],
      fri: [{ open: "09:00", close: "20:00" }],
      sat: [{ open: "10:00", close: "18:00" }],
      sun: [],
    },
  };

  const schedule24SevenAllDays: VenueOpeningHours = {
    timeZone: "Europe/London",
    schedule: {
      mon: [{ open: "00:00", close: "24:00" }],
      tue: [{ open: "00:00", close: "24:00" }],
      wed: [{ open: "00:00", close: "24:00" }],
      thu: [{ open: "00:00", close: "24:00" }],
      fri: [{ open: "00:00", close: "24:00" }],
      sat: [{ open: "00:00", close: "24:00" }],
      sun: [{ open: "00:00", close: "24:00" }],
    },
  };

  const schedule24SevenEqualTimes: VenueOpeningHours = {
    timeZone: "America/New_York",
    schedule: {
      mon: [{ open: "08:00", close: "08:00" }],
      tue: [{ open: "08:00", close: "08:00" }],
      wed: [{ open: "08:00", close: "08:00" }],
      thu: [{ open: "08:00", close: "08:00" }],
      fri: [{ open: "08:00", close: "08:00" }],
      sat: [{ open: "08:00", close: "08:00" }],
      sun: [{ open: "08:00", close: "08:00" }],
    },
  };

  describe("formatCountdown helper", () => {
    it("formats minutes under 1 hour correctly", () => {
      expect(formatCountdown(45, "Closes in")).toBe("Closes in 45m");
      expect(formatCountdown(35, "Opens in")).toBe("Opens in 35m");
    });

    it("formats exact hours and hours with minutes correctly", () => {
      expect(formatCountdown(60, "Closes in")).toBe("Closes in 1h");
      expect(formatCountdown(80, "Closes in")).toBe("Closes in 1h 20m");
      expect(formatCountdown(130, "Opens in")).toBe("Opens in 2h 10m");
    });
  });

  describe("isWindow24Hours & isSchedule24Seven helper validation", () => {
    it("identifies 24-hour windows correctly", () => {
      expect(isWindow24Hours({ open: "00:00", close: "24:00" })).toBe(true);
      expect(isWindow24Hours({ open: "00:00", close: "00:00" })).toBe(true);
      expect(isWindow24Hours({ open: "09:00", close: "09:00" })).toBe(true);
      expect(isWindow24Hours({ open: "09:00", close: "18:00" })).toBe(false);
      expect(isWindow24Hours({ open: "00:00", close: "23:00" })).toBe(false);
    });

    it("identifies 24/7 schedules with is24Seven flag", () => {
      expect(isSchedule24Seven({ is24Seven: true })).toBe(true);
    });

    it("identifies 24/7 schedules when all 7 days have 24-hour windows", () => {
      expect(isSchedule24Seven(schedule24SevenAllDays)).toBe(true);
      expect(isSchedule24Seven(schedule24SevenEqualTimes)).toBe(true);
    });

    it("does not falsely label partial week 24-hour schedules as 24/7", () => {
      // 24h on weekdays only
      const weekdayOnly24: VenueOpeningHours = {
        schedule: {
          mon: [{ open: "00:00", close: "24:00" }],
          tue: [{ open: "00:00", close: "24:00" }],
          wed: [{ open: "00:00", close: "24:00" }],
          thu: [{ open: "00:00", close: "24:00" }],
          fri: [{ open: "00:00", close: "24:00" }],
          sat: [],
          sun: [],
        },
      };
      expect(isSchedule24Seven(weekdayOnly24)).toBe(false);
    });

    it("does not label ordinary business hours as 24/7", () => {
      expect(isSchedule24Seven(standardSchedule)).toBe(false);
      expect(isSchedule24Seven({})).toBe(false);
      expect(isSchedule24Seven(undefined)).toBe(false);
    });
  });

  describe("Open 24 Hours badge variant (Issue #10296)", () => {
    it("renders emerald pill labeled 'Open 24 Hours' when is24Seven is true", () => {
      render(
        <VenueHoursBadge
          openingHours={{ is24Seven: true, timeZone: "UTC" }}
          showCountdown
        />,
      );

      const badge = screen.getByTestId("venue-opening-badge");
      expect(badge).toHaveAttribute("data-state", "open_24_hours");
      expect(badge.textContent).toBe("Open 24 Hours");
      expect(badge.className).toContain("text-emerald-800");
      expect(badge.className).toContain("border-emerald-400/80");
      expect(badge).toHaveAttribute("aria-label", "Venue is open 24 hours, operating 24/7");
    });

    it("renders emerald pill labeled 'Open 24 Hours' when all 7 days operate 24 hours (00:00 - 24:00)", () => {
      render(
        <VenueHoursBadge
          openingHours={schedule24SevenAllDays}
          currentTime="2026-11-24T12:00:00.000Z"
          showCountdown
        />,
      );

      const badge = screen.getByTestId("venue-opening-badge");
      expect(badge).toHaveAttribute("data-state", "open_24_hours");
      expect(badge.textContent).toBe("Open 24 Hours");
      expect(badge.className).toContain("bg-emerald-50");
    });

    it("renders emerald pill labeled 'Open 24 Hours' when all 7 days have equal open/close times", () => {
      render(
        <VenueHoursBadge
          openingHours={schedule24SevenEqualTimes}
          currentTime="2026-11-24T03:00:00.000Z"
          showCountdown
        />,
      );

      const badge = screen.getByTestId("venue-opening-badge");
      expect(badge).toHaveAttribute("data-state", "open_24_hours");
      expect(badge.textContent).toBe("Open 24 Hours");
    });

    it("does not show countdown text for 24-hour venues even when showCountdown is true", () => {
      render(
        <VenueHoursBadge
          openingHours={{ is24Seven: true }}
          currentTime="2026-11-24T15:30:00.000Z"
          showCountdown={true}
        />,
      );

      const badge = screen.getByTestId("venue-opening-badge");
      expect(badge.textContent).toBe("Open 24 Hours");
      expect(badge.textContent).not.toContain("Closes in");
      expect(badge.textContent).not.toContain("Opens in");
    });
  });

  describe("VenueHoursBadge presentation & status states", () => {
    it("renders green open state with countdown when closing > 60m away during daytime", () => {
      // 09:00 UTC = 14:30 in Kolkata (+5:30), close is 20:00 (5h 30m away)
      render(
        <VenueHoursBadge
          openingHours={standardSchedule}
          currentTime="2026-11-24T09:00:00.000Z"
          showCountdown
        />,
      );

      const badge = screen.getByTestId("venue-opening-badge");
      expect(badge).toHaveAttribute("data-state", "open");
      expect(badge.textContent).toBe("Closes in 5h 30m");
      expect(badge.className).toContain("text-emerald-800");
    });

    it("renders amber warning state when closing within 60 minutes during evening", () => {
      // 13:45 UTC = 19:15 in Kolkata (+5:30), close is 20:00 (45m away)
      render(
        <VenueHoursBadge
          openingHours={standardSchedule}
          currentTime="2026-11-24T13:45:00.000Z"
          showCountdown
        />,
      );

      const badge = screen.getByTestId("venue-opening-badge");
      expect(badge).toHaveAttribute("data-state", "closing_soon");
      expect(badge.textContent).toBe("Closes in 45m");
      expect(badge.className).toContain("text-amber-900");
    });

    it("renders slate closed state with countdown until next opening", () => {
      // 15:30 UTC = 21:00 in Kolkata (+5:30), venue closed at 20:00, opens next day 09:00 (12h away)
      render(
        <VenueHoursBadge
          openingHours={standardSchedule}
          currentTime="2026-11-24T15:30:00.000Z"
          showCountdown
        />,
      );

      const badge = screen.getByTestId("venue-opening-badge");
      expect(badge).toHaveAttribute("data-state", "closed");
      expect(badge.textContent).toBe("Opens in 12h");
      expect(badge.className).toContain("text-slate-700");
    });

    it("handles cross-midnight operating hours correctly", () => {
      const nightlifeVenue: VenueOpeningHours = {
        timeZone: "UTC",
        schedule: {
          fri: [{ open: "20:00", close: "04:00" }],
        },
      };

      // Friday 22:00 UTC (open, 6h remaining until 04:00)
      const { rerender } = render(
        <VenueHoursBadge
          openingHours={nightlifeVenue}
          currentTime="2026-11-27T22:00:00.000Z"
          showCountdown
        />,
      );
      expect(screen.getByTestId("venue-opening-badge").textContent).toBe(
        "Closes in 6h",
      );
      expect(screen.getByTestId("venue-opening-badge")).toHaveAttribute(
        "data-state",
        "open",
      );

      // Saturday 03:15 UTC (cross-midnight, closing in 45m -> amber)
      rerender(
        <VenueHoursBadge
          openingHours={nightlifeVenue}
          currentTime="2026-11-28T03:15:00.000Z"
          showCountdown
        />,
      );
      expect(screen.getByTestId("venue-opening-badge").textContent).toBe(
        "Closes in 45m",
      );
      expect(screen.getByTestId("venue-opening-badge")).toHaveAttribute(
        "data-state",
        "closing_soon",
      );
    });

    it("handles timezone differences correctly when venue timezone differs from UTC/browser", () => {
      const nyVenue: VenueOpeningHours = {
        timeZone: "America/New_York",
        schedule: {
          mon: [{ open: "08:00", close: "18:00" }],
        },
      };

      // 2026-11-23T18:00:00Z = 13:00 EST in New York (UTC-5), 5h remaining until 18:00
      render(
        <VenueHoursBadge
          openingHours={nyVenue}
          currentTime="2026-11-23T18:00:00.000Z"
          showCountdown
        />,
      );

      const badge = screen.getByTestId("venue-opening-badge");
      expect(badge.textContent).toBe("Closes in 5h");
      expect(badge).toHaveAttribute("data-state", "open");
    });

    it("handles missing or unconfigured operating hours gracefully", () => {
      render(<VenueHoursBadge openingHours={{}} showCountdown />);
      const badge = screen.getByTestId("venue-opening-badge");
      expect(badge).toHaveAttribute("data-state", "closed");
      expect(badge.textContent).toBe("Closed");
    });
  });

  describe("periodic countdown refresh and unmount cleanup", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("refreshes the countdown every 60 seconds when using live clock", () => {
      // Set system time to 13:45 UTC (19:15 in Kolkata, 45m remaining)
      jest.setSystemTime(new Date("2026-11-24T13:45:00.000Z"));

      render(<VenueHoursBadge openingHours={standardSchedule} showCountdown />);

      expect(screen.getByTestId("venue-opening-badge").textContent).toBe(
        "Closes in 45m",
      );

      // Advance by 1 minute (60,000ms)
      act(() => {
        jest.advanceTimersByTime(60_000);
      });

      expect(screen.getByTestId("venue-opening-badge").textContent).toBe(
        "Closes in 44m",
      );

      // Advance by another 10 minutes
      act(() => {
        jest.advanceTimersByTime(600_000);
      });

      expect(screen.getByTestId("venue-opening-badge").textContent).toBe(
        "Closes in 34m",
      );
    });

    it("cleans up interval timer on unmount", () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      const { unmount } = render(
        <VenueHoursBadge openingHours={standardSchedule} showCountdown />,
      );

      expect(clearIntervalSpy).not.toHaveBeenCalled();
      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
