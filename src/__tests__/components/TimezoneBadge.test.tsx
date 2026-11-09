import React from "react";
import { render, screen, act } from "@testing-library/react";
import {
  TimezoneBadge,
  getUserTimezone,
  formatLocalTime,
  getDayDifference,
  formatDayIndicator,
} from "@/components/TimezoneBadge";

const mockIntl = (resolved: () => unknown) =>
  jest
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementation(
      () => ({ resolvedOptions: resolved }) as unknown as Intl.DateTimeFormat,
    );

describe("getUserTimezone", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the detected IANA timezone", () => {
    mockIntl(() => ({ timeZone: "Asia/Kolkata" }));
    expect(getUserTimezone()).toBe("Asia/Kolkata");
  });

  it("falls back to UTC when timeZone is undefined", () => {
    mockIntl(() => ({ timeZone: undefined }));
    expect(getUserTimezone()).toBe("UTC");
  });

  it("falls back to UTC when Intl throws", () => {
    jest.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("Intl unavailable");
    });
    expect(getUserTimezone()).toBe("UTC");
  });
});

describe("formatLocalTime", () => {
  it("formats local time for specified IANA timezone with hour and minute", () => {
    const testDate = new Date("2026-10-12T17:05:00Z");
    const formatted = formatLocalTime(testDate, "UTC", "en-US");
    expect(formatted).toMatch(/5:05\s*PM/);
  });

  it("returns null on invalid timezone", () => {
    const testDate = new Date();
    const formatted = formatLocalTime(testDate, "Invalid/Unknown_Tz");
    expect(formatted).toBeNull();
  });
});

describe("getDayDifference and formatDayIndicator", () => {
  it("calculates +1 day when target timezone is ahead of client timezone", () => {
    // 2026-10-12 02:00 UTC is Oct 11 22:00 EDT and Oct 12 11:00 JST
    const date = new Date("2026-10-12T02:00:00Z");
    const diff = getDayDifference(date, "Asia/Tokyo", "America/New_York");
    expect(diff).toBe(1);
    expect(formatDayIndicator(diff)).toBe("+1 day");
  });

  it("calculates -1 day when target timezone is behind client timezone", () => {
    // 2026-10-12 02:00 UTC is Oct 12 11:00 JST and Oct 11 22:00 EDT
    const date = new Date("2026-10-12T02:00:00Z");
    const diff = getDayDifference(date, "America/New_York", "Asia/Tokyo");
    expect(diff).toBe(-1);
    expect(formatDayIndicator(diff)).toBe("-1 day");
  });

  it("returns 0 and null day indicator when timezones share the same calendar day", () => {
    const date = new Date("2026-10-12T12:00:00Z");
    const diff = getDayDifference(date, "Europe/London", "UTC");
    expect(diff).toBe(0);
    expect(formatDayIndicator(diff)).toBeNull();
  });
});

describe("TimezoneBadge", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the detected timezone and a copy button", () => {
    mockIntl(() => ({ timeZone: "America/New_York" }));
    render(<TimezoneBadge />);
    expect(screen.getByTestId("timezone-value").textContent).toBe(
      "America/New_York",
    );
    expect(
      screen.getByRole("button", { name: /copy to clipboard/i }),
    ).toBeTruthy();
  });

  it("shows UTC when the Intl API returns undefined", () => {
    mockIntl(() => ({ timeZone: undefined }));
    render(<TimezoneBadge />);
    expect(screen.getByTestId("timezone-value").textContent).toBe("UTC");
  });

  it("renders live formatted local clock next to the timezone identifier", () => {
    render(<TimezoneBadge timeZone="America/New_York" locale="en-US" />);
    expect(screen.getByTestId("timezone-value").textContent).toBe(
      "America/New_York",
    );
    const clock = screen.getByTestId("local-time-clock");
    expect(clock).toBeInTheDocument();
    expect(clock.textContent).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)?/i);
  });

  it("updates time indicator on a 60-second interval timer", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-12T10:00:00Z"));

    render(<TimezoneBadge timeZone="UTC" locale="en-US" />);

    const initialTime = screen.getByTestId("local-time-clock").textContent;
    expect(initialTime).toMatch(/10:00\s*AM/i);

    // Advance 60 seconds (60,000ms)
    act(() => {
      jest.advanceTimersByTime(60000);
    });

    const updatedTime = screen.getByTestId("local-time-clock").textContent;
    expect(updatedTime).toMatch(/10:01\s*AM/i);

    jest.useRealTimers();
  });

  it("displays +1 day indicator when member's day is ahead of client's day", () => {
    jest.useFakeTimers();
    // 02:00 UTC: America/New_York is Oct 11, Asia/Tokyo is Oct 12
    jest.setSystemTime(new Date("2026-10-12T02:00:00Z"));

    render(
      <TimezoneBadge timeZone="Asia/Tokyo" clientTimezone="America/New_York" />,
    );

    const dayIndicator = screen.getByTestId("day-indicator");
    expect(dayIndicator).toBeInTheDocument();
    expect(dayIndicator.textContent).toBe("+1 day");

    jest.useRealTimers();
  });

  it("displays -1 day indicator when member's day is behind client's day", () => {
    jest.useFakeTimers();
    // 02:00 UTC: Asia/Tokyo is Oct 12, America/New_York is Oct 11
    jest.setSystemTime(new Date("2026-10-12T02:00:00Z"));

    render(
      <TimezoneBadge timeZone="America/New_York" clientTimezone="Asia/Tokyo" />,
    );

    const dayIndicator = screen.getByTestId("day-indicator");
    expect(dayIndicator).toBeInTheDocument();
    expect(dayIndicator.textContent).toBe("-1 day");

    jest.useRealTimers();
  });

  it("does not render day indicator when days match", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-12T12:00:00Z"));

    render(<TimezoneBadge timeZone="UTC" clientTimezone="UTC" />);

    expect(screen.queryByTestId("day-indicator")).not.toBeInTheDocument();

    jest.useRealTimers();
  });
});
