import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ColleaguePresenceIndicator,
  formatRelativeLastSeen,
  PRESENCE_REFRESH_INTERVAL_MS,
  ColleaguePresenceItem,
} from "@/components/social/ColleaguePresenceIndicator";

jest.mock("@/hooks/useColleaguePresence", () => ({
  useColleaguePresence: jest.fn(() => ({
    activeCount: 0,
    colleagues: [],
    isSelfPresent: false,
    isLoading: false,
    error: null,
    refresh: jest.fn(),
    publishPresence: jest.fn(),
    leaveVenue: jest.fn(),
  })),
}));

describe("formatRelativeLastSeen", () => {
  const baseTime = new Date("2026-10-12T12:00:00Z");

  it("returns 'Active just now' when timestamp is missing or null", () => {
    expect(formatRelativeLastSeen(undefined, baseTime)).toBe("Active just now");
    expect(formatRelativeLastSeen(null, baseTime)).toBe("Active just now");
  });

  it("returns 'Active recently' for invalid timestamps", () => {
    expect(formatRelativeLastSeen("invalid-date", baseTime)).toBe(
      "Active recently",
    );
  });

  it("returns 'Active just now' for timestamps less than 60 seconds ago", () => {
    const thirtySecsAgo = new Date(baseTime.getTime() - 30 * 1000);
    expect(formatRelativeLastSeen(thirtySecsAgo, baseTime)).toBe(
      "Active just now",
    );
  });

  it("formats relative minutes when diff is between 1 and 59 minutes", () => {
    const fiveMinsAgo = new Date(baseTime.getTime() - 5 * 60 * 1000);
    const result = formatRelativeLastSeen(fiveMinsAgo, baseTime);
    expect(result).toMatch(/Active.*5.*min/i);
  });

  it("formats relative hours when diff is between 1 and 23 hours", () => {
    const twoHoursAgo = new Date(baseTime.getTime() - 2 * 60 * 60 * 1000);
    const result = formatRelativeLastSeen(twoHoursAgo, baseTime);
    expect(result).toMatch(/Active.*2.*(hr|hour)/i);
  });

  it("formats relative days when diff is 24+ hours", () => {
    const twoDaysAgo = new Date(baseTime.getTime() - 48 * 60 * 60 * 1000);
    const result = formatRelativeLastSeen(twoDaysAgo, baseTime);
    expect(result).toMatch(/Active.*2.*(d|day)/i);
  });

  it("respects custom options and locales", () => {
    const tenMinsAgo = new Date(baseTime.getTime() - 10 * 60 * 1000);
    const result = formatRelativeLastSeen(tenMinsAgo, baseTime, {
      locale: "en-US",
      style: "long",
    });
    expect(result).toBe("Active 10 minutes ago");
  });
});

describe("ColleaguePresenceIndicator component", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const mockColleagues: ColleaguePresenceItem[] = [
    {
      userId: "user-1",
      name: "Alice Smith",
      seatNumber: "A12",
      statusNote: "Working on PR reviews",
      lastSeen: new Date("2026-10-12T12:00:00Z").toISOString(),
    },
  ];

  it("renders teammate presence correctly and opens modal", () => {
    render(
      <ColleaguePresenceIndicator
        venueId="venue-123"
        venueName="Central Cowork"
        initialColleagues={mockColleagues}
      />,
    );

    expect(screen.getByText(/1 Teammate Working Here/i)).toBeInTheDocument();

    const viewButton = screen.getByRole("button", {
      name: /View Presence/i,
    });
    fireEvent.click(viewButton);

    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Seat A12")).toBeInTheDocument();
    expect(screen.getByText('"Working on PR reviews"')).toBeInTheDocument();
  });

  it("dynamically refreshes relative timestamps every 60 seconds", () => {
    const now = new Date("2026-10-12T12:00:15Z");
    jest.setSystemTime(now);

    render(
      <ColleaguePresenceIndicator
        venueId="venue-123"
        venueName="Central Cowork"
        initialColleagues={mockColleagues}
      />,
    );

    // Open modal
    fireEvent.click(screen.getByRole("button", { name: /View Presence/i }));

    // Initially at 15 seconds after lastSeen: "Active just now"
    const timestampElem = screen.getByTestId("colleague-last-seen");
    expect(timestampElem).toHaveTextContent("Active just now");

    // Advance time by 60,000ms (1 minute interval)
    act(() => {
      jest.advanceTimersByTime(PRESENCE_REFRESH_INTERVAL_MS);
    });

    // Now 75 seconds after lastSeen: should update to ~1 min ago
    expect(timestampElem.textContent).toMatch(/Active.*1.*min/i);

    // Advance time by another 4 minutes (4 * 60,000ms)
    act(() => {
      jest.advanceTimersByTime(4 * PRESENCE_REFRESH_INTERVAL_MS);
    });

    // Now 5 minutes after lastSeen: should update to ~5 min ago
    expect(timestampElem.textContent).toMatch(/Active.*5.*min/i);
  });

  it("cleans up timer interval cleanly on unmount", () => {
    const clearIntervalSpy = jest.spyOn(window, "clearInterval");

    const { unmount } = render(
      <ColleaguePresenceIndicator
        venueId="venue-123"
        initialColleagues={mockColleagues}
      />,
    );

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("supports custom refresh interval prop", () => {
    const now = new Date("2026-10-12T12:00:10Z");
    jest.setSystemTime(now);

    render(
      <ColleaguePresenceIndicator
        venueId="venue-123"
        initialColleagues={mockColleagues}
        refreshIntervalMs={10000}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /View Presence/i }));
    const timestampElem = screen.getByTestId("colleague-last-seen");
    expect(timestampElem).toHaveTextContent("Active just now");

    // Advance by 10s: total 20s
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(timestampElem).toHaveTextContent("Active just now");

    // Advance by 50s: total 70s -> 1 min ago
    act(() => {
      jest.advanceTimersByTime(50000);
    });
    expect(timestampElem.textContent).toMatch(/Active.*1.*min/i);
  });
});
