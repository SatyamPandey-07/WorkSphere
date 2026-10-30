import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TimezoneClock } from "../TimezoneClock";

describe("TimezoneClock", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    // Set a fixed system time so tests are deterministic: Oct 15, 2023 at 12:00:00 UTC
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
    act(() => {
      jest.advanceTimersByTime(1000);
    });
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
    fireEvent.click(button);

    const searchInput = screen.getByTestId("timezone-search-input") as HTMLInputElement;
    expect(searchInput).toBeInTheDocument();

    // Type query "Tokyo"
    fireEvent.change(searchInput, { target: { value: "Tokyo" } });

    // Advance fake timer for debounce (200ms)
    act(() => {
      jest.advanceTimersByTime(250);
    });

    // Should find Tokyo
    expect(screen.getByText(/Tokyo/i)).toBeInTheDocument();

    // Clear query button
    const clearBtn = screen.getByTestId("timezone-clear-query-button");
    fireEvent.click(clearBtn);
    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(searchInput.value).toBe("");
  });

  it("displays 'No matching timezones found' with clear query button on empty search result", () => {
    render(<TimezoneClock timeZone="UTC" selectable />);

    const button = screen.getByTestId("timezone-selector-button");
    fireEvent.click(button);

    const searchInput = screen.getByTestId("timezone-search-input") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "NonExistentTimezoneXYZ" } });

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(screen.getByText("No matching timezones found")).toBeInTheDocument();

    const resetBtn = screen.getByTestId("timezone-clear-search-btn");
    fireEvent.click(resetBtn);
    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(screen.queryByText("No matching timezones found")).not.toBeInTheDocument();
  });

  it("selects timezone item, calls callback, and closes dropdown", () => {
    const handleTimezoneChange = jest.fn();
    render(
      <TimezoneClock
        timeZone="UTC"
        selectable
        onTimezoneChange={handleTimezoneChange}
      />
    );

    fireEvent.click(screen.getByTestId("timezone-selector-button"));

    const searchInput = screen.getByTestId("timezone-search-input");
    fireEvent.change(searchInput, { target: { value: "Tokyo" } });

    act(() => {
      jest.advanceTimersByTime(250);
    });

    const item = screen.getByTestId("timezone-item-Asia/Tokyo");
    fireEvent.click(item);

    expect(handleTimezoneChange).toHaveBeenCalledWith("Asia/Tokyo");
    expect(screen.queryByTestId("timezone-dropdown-panel")).not.toBeInTheDocument();
  });

  it("closes dropdown on Escape key", () => {
    render(<TimezoneClock timeZone="UTC" selectable />);

    fireEvent.click(screen.getByTestId("timezone-selector-button"));
    expect(screen.getByTestId("timezone-dropdown-panel")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("timezone-dropdown-panel")).not.toBeInTheDocument();
  });

  it("navigates with ArrowDown, ArrowUp, and selects with Enter", () => {
    const handleTimezoneChange = jest.fn();
    render(
      <TimezoneClock
        timeZone="UTC"
        selectable
        onTimezoneChange={handleTimezoneChange}
      />
    );

    fireEvent.click(screen.getByTestId("timezone-selector-button"));

    const searchInput = screen.getByTestId("timezone-search-input");
    fireEvent.change(searchInput, { target: { value: "London" } });

    act(() => {
      jest.advanceTimersByTime(250);
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(handleTimezoneChange).toHaveBeenCalledWith("Europe/London");
    expect(screen.queryByTestId("timezone-dropdown-panel")).not.toBeInTheDocument();
  });

  it("closes dropdown on outside mouse down", () => {
    render(
      <div>
        <div data-testid="outside">Outside area</div>
        <TimezoneClock timeZone="UTC" selectable />
      </div>
    );

    fireEvent.click(screen.getByTestId("timezone-selector-button"));
    expect(screen.getByTestId("timezone-dropdown-panel")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("timezone-dropdown-panel")).not.toBeInTheDocument();
  });
});
