import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StreakCard, type StreakData } from "@/components/dashboard/StreakCard";

describe("StreakCard Component", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockStreakData: StreakData = {
    currentStreak: 3,
    longestStreak: 7,
    lastCheckInDate: "2026-10-28",
    timezone: "UTC",
    unlockedMilestones: [],
  };

  it("renders loading skeleton initially and displays streak data on success", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockStreakData,
    } as Response);

    render(<StreakCard testId="custom-streak" className="custom-class" />);

    // Initial loading
    expect(screen.getByTestId("custom-streak-loading")).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");

    // Success state
    await waitFor(() => {
      expect(screen.getByTestId("custom-streak-count")).toHaveTextContent("3");
    });

    expect(screen.getByTestId("custom-streak")).toHaveClass("custom-class");
    expect(screen.getByTestId("custom-streak-heading")).toHaveTextContent("Activity Streak");
    expect(screen.getByTestId("custom-streak-best")).toHaveTextContent("Best: 7d");
    expect(screen.getByTestId("custom-streak-progressbar")).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByTestId("custom-streak-progress-label")).toHaveTextContent("3 / 5 days");

    // Milestone badges rendered
    expect(screen.getByTestId("custom-streak-milestone-5")).toBeInTheDocument();
    expect(screen.getByTestId("custom-streak-milestone-10")).toBeInTheDocument();
    expect(screen.getByTestId("custom-streak-milestone-30")).toBeInTheDocument();

    // Check-in button is enabled
    expect(screen.getByTestId("custom-streak-checkin-btn")).toHaveTextContent("🔥 Check In Today");
    expect(screen.getByTestId("custom-streak-checkin-btn")).not.toBeDisabled();
  });

  it("handles check-in button click and updates streak state", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockStreakData,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          currentStreak: 4,
          longestStreak: 7,
          lastCheckInDate: "2026-10-30",
          unlockedMilestones: [],
          incremented: true,
        }),
      } as Response);

    const onCheckIn = jest.fn();

    render(<StreakCard onCheckIn={onCheckIn} testId="streak-card" />);

    await waitFor(() => {
      expect(screen.getByTestId("streak-card-count")).toHaveTextContent("3");
    });

    const checkInBtn = screen.getByTestId("streak-card-checkin-btn");
    fireEvent.click(checkInBtn);

    await waitFor(() => {
      expect(screen.getByTestId("streak-card-count")).toHaveTextContent("4");
    });

    expect(screen.getByTestId("streak-card-checkin-btn")).toHaveTextContent("✓ Checked In Today");
    expect(screen.getByTestId("streak-card-checkin-btn")).toBeDisabled();
    expect(onCheckIn).toHaveBeenCalledWith({
      currentStreak: 4,
      longestStreak: 7,
      lastCheckInDate: "2026-10-30",
      unlockedMilestones: [],
    });
  });

  it("renders checked-in state when user has already checked in today", async () => {
    // Format today date in UTC
    const today = new Date().toISOString().slice(0, 10);
    const checkedInData: StreakData = {
      currentStreak: 5,
      longestStreak: 12,
      lastCheckInDate: today,
      timezone: "UTC",
      unlockedMilestones: [5],
    };

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => checkedInData,
    } as Response);

    render(<StreakCard testId="streak-card" />);

    await waitFor(() => {
      expect(screen.getByTestId("streak-card-count")).toHaveTextContent("5");
    });

    expect(screen.getByTestId("streak-card-subheading")).toHaveTextContent("Checked in today ✓");
    expect(screen.getByTestId("streak-card-checkin-btn")).toHaveTextContent("✓ Checked In Today");
    expect(screen.getByTestId("streak-card-checkin-btn")).toBeDisabled();
  });

  it("handles 401 unauthenticated response gracefully", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    } as Response);

    const { container } = render(<StreakCard testId="streak-card" />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("handles check-in failure and displays error message", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockStreakData,
      } as Response)
      .mockRejectedValueOnce(new Error("Server error"));

    const onError = jest.fn();

    render(<StreakCard onError={onError} testId="streak-card" />);

    await waitFor(() => {
      expect(screen.getByTestId("streak-card-count")).toHaveTextContent("3");
    });

    const checkInBtn = screen.getByTestId("streak-card-checkin-btn");
    fireEvent.click(checkInBtn);

    await waitFor(() => {
      expect(screen.getByTestId("streak-card-error")).toHaveTextContent(
        "Check-in failed. Please try again."
      );
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("defensively handles missing unlockedMilestones array in API response", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        currentStreak: 2,
        longestStreak: 2,
        lastCheckInDate: null,
        unlockedMilestones: null, // missing array
      }),
    } as Response);

    render(<StreakCard testId="streak-card" />);

    await waitFor(() => {
      expect(screen.getByTestId("streak-card-count")).toHaveTextContent("2");
    });

    // Should render without throwing error
    expect(screen.getByTestId("streak-card-milestone-5")).toBeInTheDocument();
  });

  it("uses initialData directly without making a network call", () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    render(<StreakCard initialData={mockStreakData} testId="streak-card" />);

    expect(screen.getByTestId("streak-card-count")).toHaveTextContent("3");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
