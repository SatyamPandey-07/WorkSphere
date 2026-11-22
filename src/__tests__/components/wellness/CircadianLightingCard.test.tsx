import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import CircadianLightingCardDefault, {
  CircadianLightingCard,
  MIN_KELVIN,
  MAX_KELVIN,
  OVERRIDE_DURATION_MS,
  OVERRIDE_STORAGE_KEY,
  getScheduleKelvin,
  kelvinToRgb,
  formatTimeOfDay,
  formatRemaining,
  getSliderValueFromClientX,
} from "@/components/wellness/CircadianLightingCard";

// 13:30 local time on a fixed day
const NOW = new Date(2026, 10, 17, 13, 30, 0).getTime();

function setup(props: React.ComponentProps<typeof CircadianLightingCard> = {}) {
  const view = render(<CircadianLightingCard {...props} />);
  // Let the mount effect read the clock and any stored override
  act(() => {
    jest.advanceTimersByTime(1);
  });
  return view;
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

function moveSlider(minutes: number) {
  fireEvent.change(screen.getByTestId("circadian-preview-slider"), {
    target: { value: String(minutes) },
  });
}

describe("CircadianLightingCard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("exports and helpers", () => {
    it("exports the component as named and default export", () => {
      expect(CircadianLightingCard).toBeDefined();
      expect(CircadianLightingCardDefault).toBe(CircadianLightingCard);
    });

    it("exports the documented constants", () => {
      expect(MIN_KELVIN).toBe(2700);
      expect(MAX_KELVIN).toBe(6500);
      expect(OVERRIDE_DURATION_MS).toBe(60 * 60 * 1000);
    });

    it("keeps the schedule between 2700K and 6500K for every minute of the day", () => {
      for (let minute = 0; minute < 1440; minute += 1) {
        const kelvin = getScheduleKelvin(minute);
        expect(kelvin).toBeGreaterThanOrEqual(2700);
        expect(kelvin).toBeLessThanOrEqual(6500);
      }
    });

    it("is warm overnight, daylight at midday and ramps up through the morning", () => {
      expect(getScheduleKelvin(0)).toBe(2700);
      expect(getScheduleKelvin(3 * 60)).toBe(2700);
      expect(getScheduleKelvin(12 * 60)).toBe(6500);
      expect(getScheduleKelvin(23 * 60)).toBe(2700);

      let previous = getScheduleKelvin(6 * 60);
      for (let minute = 6 * 60 + 1; minute <= 9 * 60 + 30; minute += 1) {
        const kelvin = getScheduleKelvin(minute);
        expect(kelvin).toBeGreaterThanOrEqual(previous);
        previous = kelvin;
      }
    });

    it("wraps out of range minutes and tolerates NaN", () => {
      expect(getScheduleKelvin(1440 + 12 * 60)).toBe(6500);
      expect(getScheduleKelvin(-12 * 60)).toBe(6500);
      expect(getScheduleKelvin(Number.NaN)).toBe(2700);
    });

    it("maps warm kelvin to a red heavy color and daylight to a near white color", () => {
      const warm = kelvinToRgb(2700);
      const cool = kelvinToRgb(6500);
      expect(warm.r).toBe(255);
      expect(warm.b).toBeLessThan(warm.r);
      expect(cool.r).toBeGreaterThan(240);
      expect(cool.b).toBeGreaterThan(240);
      expect(cool.b).toBeGreaterThan(warm.b);
    });

    it("formats time of day and remaining time", () => {
      expect(formatTimeOfDay(0)).toBe("00:00");
      expect(formatTimeOfDay(13 * 60 + 5)).toBe("13:05");
      expect(formatTimeOfDay(5000)).toBe("23:59");
      expect(formatRemaining(60 * 60 * 1000)).toBe("60:00");
      expect(formatRemaining(1)).toBe("00:01");
      expect(formatRemaining(-5)).toBe("00:00");
    });
  });

  describe("preview slider", () => {
    it("normalizes and clamps pointer coordinates to the slider range", () => {
      const rect = { left: 100, width: 400 };
      expect(getSliderValueFromClientX(100, rect)).toBe(0);
      expect(getSliderValueFromClientX(300, rect)).toBe(720);
      expect(getSliderValueFromClientX(500, rect)).toBe(1439);
      expect(getSliderValueFromClientX(0, rect)).toBe(0);
      expect(getSliderValueFromClientX(800, rect)).toBe(1439);
      expect(getSliderValueFromClientX(300, { left: 100, width: 0 })).toBe(1439);
    });

    it("keeps mouse change events functional", () => {
      setup();
      moveSlider(450);
      expect(screen.getByTestId("circadian-preview-slider")).toHaveValue("450");
    });

    it("starts at the current time with the system schedule applied", () => {
      setup();
      expect(screen.getByTestId("circadian-preview-slider")).toHaveValue("810");
      expect(screen.getByTestId("circadian-preview-time")).toHaveTextContent(
        "13:30",
      );
      expect(screen.getByTestId("circadian-preview-kelvin")).toHaveTextContent(
        `${getScheduleKelvin(810)}K`,
      );
      expect(screen.getByTestId("circadian-applied-kelvin")).toHaveTextContent(
        `${getScheduleKelvin(810)}K`,
      );
    });

    it("updates the kelvin readout, time label and swatch gradient as the slider moves", () => {
      setup();
      const before = screen
        .getByTestId("circadian-preview-swatch")
        .getAttribute("style");

      moveSlider(7 * 60 + 30);

      expect(screen.getByTestId("circadian-preview-time")).toHaveTextContent(
        "07:30",
      );
      expect(screen.getByTestId("circadian-preview-kelvin")).toHaveTextContent(
        `${getScheduleKelvin(450)}K`,
      );
      expect(
        screen.getByTestId("circadian-preview-swatch").getAttribute("style"),
      ).not.toBe(before);
      expect(screen.getByTestId("circadian-preview-slider")).toHaveAttribute(
        "aria-valuetext",
        `07:30, ${getScheduleKelvin(450)}K`,
      );
    });

    it("does not change the applied kelvin while no override is active", () => {
      setup();
      const applied = screen.getByTestId(
        "circadian-applied-kelvin",
      ).textContent;
      moveSlider(2 * 60);
      expect(screen.getByTestId("circadian-applied-kelvin").textContent).toBe(
        applied,
      );
    });

    it("dispatches onPreviewChange with minutes and kelvin", () => {
      const onPreviewChange = jest.fn();
      setup({ onPreviewChange });

      moveSlider(18 * 60);

      expect(onPreviewChange).toHaveBeenCalledTimes(1);
      expect(onPreviewChange).toHaveBeenCalledWith({
        minutes: 1080,
        kelvin: getScheduleKelvin(1080),
      });
    });
  });

  describe("manual override", () => {
    it("starts an override from the previewed color and dispatches 'enabled'", () => {
      const onOverrideChange = jest.fn();
      setup({ onOverrideChange });
      moveSlider(7 * 60);

      fireEvent.click(screen.getByTestId("circadian-override-toggle"));

      expect(screen.getByTestId("circadian-override-toggle")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(onOverrideChange).toHaveBeenCalledTimes(1);
      expect(onOverrideChange).toHaveBeenCalledWith(
        {
          kelvin: getScheduleKelvin(420),
          startedAt: NOW + 1,
          expiresAt: NOW + 1 + OVERRIDE_DURATION_MS,
        },
        "enabled",
      );
      expect(screen.getByTestId("circadian-applied-kelvin")).toHaveTextContent(
        `${getScheduleKelvin(420)}K`,
      );
    });

    it("persists the override to localStorage", () => {
      setup();
      fireEvent.click(screen.getByTestId("circadian-override-toggle"));

      const stored = JSON.parse(
        window.localStorage.getItem(OVERRIDE_STORAGE_KEY) ?? "null",
      );
      expect(stored.kelvin).toBe(getScheduleKelvin(810));
      expect(stored.expiresAt - stored.startedAt).toBe(OVERRIDE_DURATION_MS);
    });

    it("shows a countdown for the remaining override time", () => {
      setup();
      fireEvent.click(screen.getByTestId("circadian-override-toggle"));
      expect(
        screen.getByTestId("circadian-override-remaining"),
      ).toHaveTextContent("Ends in 60:00");

      advance(90 * 1000);

      expect(
        screen.getByTestId("circadian-override-remaining"),
      ).toHaveTextContent(/Ends in 58:3[01]/);
    });

    it("keeps the timer running when the slider moves and dispatches 'updated'", () => {
      const onOverrideChange = jest.fn();
      setup({ onOverrideChange });
      fireEvent.click(screen.getByTestId("circadian-override-toggle"));
      const enabled = onOverrideChange.mock.calls[0][0];
      onOverrideChange.mockClear();

      moveSlider(20 * 60);

      expect(onOverrideChange).toHaveBeenCalledTimes(1);
      const [updated, reason] = onOverrideChange.mock.calls[0];
      expect(reason).toBe("updated");
      expect(updated.kelvin).toBe(getScheduleKelvin(1200));
      expect(updated.expiresAt).toBe(enabled.expiresAt);
      expect(screen.getByTestId("circadian-applied-kelvin")).toHaveTextContent(
        `${getScheduleKelvin(1200)}K`,
      );
    });

    it("falls back to the system schedule when the 60 minutes expire", () => {
      const onOverrideChange = jest.fn();
      setup({ onOverrideChange });
      moveSlider(2 * 60);
      fireEvent.click(screen.getByTestId("circadian-override-toggle"));
      onOverrideChange.mockClear();

      advance(OVERRIDE_DURATION_MS - 1000);
      expect(screen.getByTestId("circadian-override-toggle")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(onOverrideChange).not.toHaveBeenCalled();

      advance(1000);

      expect(onOverrideChange).toHaveBeenCalledTimes(1);
      expect(onOverrideChange).toHaveBeenCalledWith(null, "expired");
      expect(screen.getByTestId("circadian-override-toggle")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(
        screen.queryByTestId("circadian-override-remaining"),
      ).not.toBeInTheDocument();
      expect(window.localStorage.getItem(OVERRIDE_STORAGE_KEY)).toBeNull();
      // 13:30 + 60 minutes is 14:30, still daylight on the system schedule
      expect(screen.getByTestId("circadian-applied-kelvin")).toHaveTextContent(
        `${getScheduleKelvin(14 * 60 + 30)}K`,
      );
    });

    it("honors a custom overrideDurationMs", () => {
      const onOverrideChange = jest.fn();
      setup({ onOverrideChange, overrideDurationMs: 5000 });
      fireEvent.click(screen.getByTestId("circadian-override-toggle"));
      onOverrideChange.mockClear();

      advance(5000);

      expect(onOverrideChange).toHaveBeenCalledWith(null, "expired");
    });

    it("clears the override when toggled off and dispatches 'cleared'", () => {
      const onOverrideChange = jest.fn();
      setup({ onOverrideChange });
      fireEvent.click(screen.getByTestId("circadian-override-toggle"));
      onOverrideChange.mockClear();

      fireEvent.click(screen.getByTestId("circadian-override-toggle"));

      expect(onOverrideChange).toHaveBeenCalledWith(null, "cleared");
      expect(screen.getByTestId("circadian-override-toggle")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(window.localStorage.getItem(OVERRIDE_STORAGE_KEY)).toBeNull();
    });
  });

  describe("persistence", () => {
    it("restores an unexpired override with its remaining time", () => {
      const onOverrideChange = jest.fn();
      const saved = {
        kelvin: 3100,
        startedAt: NOW - 10 * 60 * 1000,
        expiresAt: NOW + 20 * 60 * 1000,
      };
      window.localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(saved));

      setup({ onOverrideChange });

      expect(onOverrideChange).toHaveBeenCalledWith(saved, "restored");
      expect(screen.getByTestId("circadian-override-toggle")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.getByTestId("circadian-applied-kelvin")).toHaveTextContent(
        "3100K",
      );
      expect(
        screen.getByTestId("circadian-override-remaining"),
      ).toHaveTextContent("Ends in 20:00");
    });

    it("discards an expired stored override", () => {
      const onOverrideChange = jest.fn();
      window.localStorage.setItem(
        OVERRIDE_STORAGE_KEY,
        JSON.stringify({
          kelvin: 3100,
          startedAt: NOW - 7200000,
          expiresAt: NOW - 3600000,
        }),
      );

      setup({ onOverrideChange });

      expect(onOverrideChange).toHaveBeenCalledWith(null, "expired");
      expect(screen.getByTestId("circadian-override-toggle")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(window.localStorage.getItem(OVERRIDE_STORAGE_KEY)).toBeNull();
    });

    it("ignores corrupt or out of range stored data", () => {
      window.localStorage.setItem(OVERRIDE_STORAGE_KEY, "{not json");
      setup();
      expect(screen.getByTestId("circadian-override-toggle")).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    it("ignores stored kelvin outside 2700K to 6500K", () => {
      window.localStorage.setItem(
        OVERRIDE_STORAGE_KEY,
        JSON.stringify({
          kelvin: 9000,
          startedAt: NOW,
          expiresAt: NOW + 60000,
        }),
      );
      setup();
      expect(screen.getByTestId("circadian-override-toggle")).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    it("keeps working when localStorage throws", () => {
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      setup();

      fireEvent.click(screen.getByTestId("circadian-override-toggle"));

      expect(screen.getByTestId("circadian-override-toggle")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
  });

  describe("lifecycle", () => {
    it("stops its timers on unmount", () => {
      const onOverrideChange = jest.fn();
      const { unmount } = setup({ onOverrideChange, overrideDurationMs: 3000 });
      fireEvent.click(screen.getByTestId("circadian-override-toggle"));
      onOverrideChange.mockClear();

      unmount();
      advance(10000);

      expect(onOverrideChange).not.toHaveBeenCalled();
    });
  });
});
