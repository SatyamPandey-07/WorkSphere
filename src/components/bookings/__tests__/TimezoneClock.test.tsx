import React from "react";
import { render, screen } from "@testing-library/react";
import { TimezoneClock } from "../TimezoneClock";

describe("TimezoneClock", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    // Set a fixed system time so tests are deterministic.
    // Oct 15, 2023 at 12:00:00 UTC
    jest.setSystemTime(new Date("2023-10-15T12:00:00Z"));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("renders correctly for EST/EDT (America/New_York)", () => {
    render(<TimezoneClock timeZone="America/New_York" />);
    // 12:00:00Z is 08:00:00 AM EDT (in Oct, daylight saving time is active)
    expect(screen.getByText(/08:00:00\s*AM/)).toBeInTheDocument();
    expect(screen.getByText("EDT")).toBeInTheDocument();
  });

  it("renders correctly for PST/PDT (America/Los_Angeles)", () => {
    render(<TimezoneClock timeZone="America/Los_Angeles" />);
    // 12:00:00Z is 05:00:00 AM PDT
    expect(screen.getByText(/05:00:00\s*AM/)).toBeInTheDocument();
    expect(screen.getByText("PDT")).toBeInTheDocument();
  });

  it("renders correctly for JST (Asia/Tokyo)", () => {
    render(<TimezoneClock timeZone="Asia/Tokyo" />);
    // 12:00:00Z is 09:00:00 PM JST
    expect(screen.getByText(/09:00:00\s*PM/)).toBeInTheDocument();
    expect(screen.getByText(/JST|GMT\+9/)).toBeInTheDocument();
  });

  it("renders correctly for UTC", () => {
    render(<TimezoneClock timeZone="UTC" />);
    expect(screen.getByText(/12:00:00\s*PM/)).toBeInTheDocument();
    expect(screen.getByText("UTC")).toBeInTheDocument();
  });

  it("handles invalid timezone identifiers gracefully", () => {
    render(<TimezoneClock timeZone="Invalid/Timezone" />);
    jest.runOnlyPendingTimers();
    expect(screen.getByText("--:--:-- --")).toBeInTheDocument();
    expect(screen.getByText("Invalid/Timezone")).toBeInTheDocument();
  });

  it("filters timezones with debounced search query and shows clear button", () => {
    const handleTimezoneChange = jest.fn();
    render(
      <TimezoneClock
        timeZone="UTC"
        selectable
        onTimezoneChange={handleTimezoneChange}
      />
    );

    // Open dropdown
    const button = screen.getByTestId("timezone-selector-button");
    button.click();

    const searchInput = screen.getByTestId("timezone-search-input") as HTMLInputElement;
    expect(searchInput).toBeInTheDocument();

    // Type query "Tokyo"
    searchInput.value = "Tokyo";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Advance fake timer for debounce (200ms)
    jest.advanceTimersByTime(250);

    // Should find Tokyo
    expect(screen.getByText(/Tokyo/i)).toBeInTheDocument();

    // Clear query button
    const clearBtn = screen.getByTestId("timezone-clear-query-button");
    clearBtn.click();
    jest.advanceTimersByTime(250);

    expect(searchInput.value).toBe("");
  });

  it("displays 'No matching timezones found' with clear query button on empty search result", () => {
    render(<TimezoneClock timeZone="UTC" selectable />);

    const button = screen.getByTestId("timezone-selector-button");
    button.click();

    const searchInput = screen.getByTestId("timezone-search-input") as HTMLInputElement;
    searchInput.value = "NonExistentTimezoneXYZ";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    jest.advanceTimersByTime(250);

    expect(screen.getByText("No matching timezones found")).toBeInTheDocument();

    const resetBtn = screen.getByTestId("timezone-clear-search-btn");
    resetBtn.click();
    jest.advanceTimersByTime(250);

    expect(screen.queryByText("No matching timezones found")).not.toBeInTheDocument();
  });
});
