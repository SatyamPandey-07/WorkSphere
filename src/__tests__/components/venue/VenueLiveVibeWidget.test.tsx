import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  VenueLiveVibeWidget,
  VenueLivePulseBadge,
} from "@/components/venue/VenueLiveVibeWidget";
import type { VibeSummary } from "@/lib/venues/liveVibeTypes";

const mockVibe: VibeSummary = {
  dominantVibe: "silent_focus",
  badgeText: "Silent Focus · Deep Work",
  pulseColor: "emerald",
  emoji: "🤫",
  totalVotes: 10,
  breakdown: {
    silent_focus: 6,
    moderate_buzz: 3,
    lively: 1,
  },
  verifiedCheckIns: 4,
  lastUpdated: "2026-10-30T10:00:00.000Z",
};

describe("VenueLivePulseBadge", () => {
  it("renders with fallback styles when vibe is null", () => {
    render(<VenueLivePulseBadge vibe={null} />);
    const badge = screen.getByTestId("venue-live-pulse-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Live Vibe · Checking…");
    expect(screen.queryByTestId("live-pulse-ping")).toBeNull();
  });

  it("renders with emerald pulse and animated ping", () => {
    render(<VenueLivePulseBadge vibe={mockVibe} />);
    const badge = screen.getByTestId("venue-live-pulse-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Silent Focus · Deep Work");
    expect(screen.getByTestId("live-pulse-emoji")).toHaveTextContent("🤫");
    expect(screen.getByTestId("live-pulse-ping")).toBeInTheDocument();
  });

  it("handles unknown pulseColor gracefully falling back to zinc", () => {
    const invalidVibe: VibeSummary = {
      ...mockVibe,
      pulseColor: "neon-cyan" as any,
    };
    render(<VenueLivePulseBadge vibe={invalidVibe} />);
    const badge = screen.getByTestId("venue-live-pulse-badge");
    expect(badge).toBeInTheDocument();
    expect(screen.queryByTestId("live-pulse-ping")).toBeNull();
  });

  it("handles invalid lastUpdated date safely without crashing", () => {
    const corruptDateVibe: VibeSummary = {
      ...mockVibe,
      lastUpdated: "invalid-date",
    };
    render(<VenueLivePulseBadge vibe={corruptDateVibe} />);
    const badge = screen.getByTestId("venue-live-pulse-badge");
    expect(badge).toBeInTheDocument();
  });
});

describe("VenueLiveVibeWidget", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("renders initial vibe correctly without making an immediate fetch", () => {
    render(<VenueLiveVibeWidget venueId="venue-123" initialVibe={mockVibe} />);
    expect(screen.getByTestId("venue-live-vibe-widget")).toBeInTheDocument();
    expect(screen.getByText("Live Atmosphere")).toBeInTheDocument();
    expect(screen.getByTestId("live-vibe-reports-count")).toHaveTextContent(
      "10 live reports",
    );
    expect(screen.getByTestId("live-vibe-verified-badge")).toHaveTextContent(
      "4 verified on-site",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches live vibe when initialVibe is null", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ vibe: mockVibe }),
    });

    await act(async () => {
      render(<VenueLiveVibeWidget venueId="venue-456" initialVibe={null} />);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/venues/venue-456/vibe");
    });

    await waitFor(() => {
      expect(screen.getByTestId("live-vibe-reports-count")).toHaveTextContent(
        "10 live reports",
      );
    });
  });

  it("handles fetch failure gracefully", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network error"),
    );

    await act(async () => {
      render(<VenueLiveVibeWidget venueId="venue-456" initialVibe={null} />);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    expect(screen.getByTestId("venue-live-vibe-widget")).toBeInTheDocument();
  });

  it("renders in compact mode hiding percentages and progress bar", () => {
    render(
      <VenueLiveVibeWidget
        venueId="venue-123"
        initialVibe={mockVibe}
        compact={true}
      />,
    );

    expect(screen.getByTestId("live-vibe-reaction-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("vibe-pct-silent_focus")).toBeNull();
    expect(
      screen.queryByTestId("live-vibe-progress-bar-container"),
    ).toBeNull();
  });

  it("hides reaction bar completely when showReactionBar is false", () => {
    render(
      <VenueLiveVibeWidget
        venueId="venue-123"
        initialVibe={mockVibe}
        showReactionBar={false}
      />,
    );

    expect(screen.queryByTestId("live-vibe-reaction-bar")).toBeNull();
  });

  it("optimistically updates and submits a vote successfully", async () => {
    const onVoteSubmitted = jest.fn();
    const updatedVibe: VibeSummary = {
      ...mockVibe,
      totalVotes: 11,
      breakdown: {
        ...mockVibe.breakdown,
        silent_focus: 7,
      },
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ vibe: updatedVibe }),
    });

    render(
      <VenueLiveVibeWidget
        venueId="venue-123"
        initialVibe={mockVibe}
        onVoteSubmitted={onVoteSubmitted}
      />,
    );

    const silentFocusBtn = screen.getByTestId("vibe-btn-silent_focus");
    expect(silentFocusBtn).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(silentFocusBtn);
    });

    expect(silentFocusBtn).toHaveAttribute("aria-pressed", "true");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/venues/venue-123/vibe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ vibe: "silent_focus" }),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("live-vibe-voted-banner")).toBeInTheDocument();
      expect(onVoteSubmitted).toHaveBeenCalledWith(updatedVibe);
    });

    // Advance timer to verify success banner timeout
    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.queryByTestId("live-vibe-voted-banner")).toBeNull();
  });

  it("rolls back optimistic vote and displays error banner when submission fails", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Rate limit exceeded. Try again later." }),
    });

    render(<VenueLiveVibeWidget venueId="venue-123" initialVibe={mockVibe} />);

    const buzzBtn = screen.getByTestId("vibe-btn-moderate_buzz");

    await act(async () => {
      fireEvent.click(buzzBtn);
    });

    await waitFor(() => {
      const errorBanner = screen.getByTestId("live-vibe-error-banner");
      expect(errorBanner).toBeInTheDocument();
      expect(errorBanner).toHaveTextContent("Rate limit exceeded. Try again later.");
    });

    // Total votes rolled back
    expect(screen.getByTestId("live-vibe-reports-count")).toHaveTextContent(
      "10 live reports",
    );
  });

  it("periodically refetches vibe every 45 seconds", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ vibe: mockVibe }),
    });

    render(<VenueLiveVibeWidget venueId="venue-123" initialVibe={mockVibe} />);

    expect(global.fetch).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(45000);
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/venues/venue-123/vibe");
  });
});
