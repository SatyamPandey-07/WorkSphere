import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { apiFetch } from "@/lib/apiClient";

jest.mock("@/lib/apiClient", () => ({ apiFetch: jest.fn() }));
jest.mock("@/hooks/useRealTime", () => ({
  useMultiplayerSession: () => ({ socket: null, isHydrated: true }),
}));
jest.mock("@/hooks/useSpeechSynthesis", () => ({
  useSpeechSynthesis: () => ({
    isSpeaking: false,
    autoRead: false,
    rate: 1,
    toggleAutoRead: jest.fn(),
    changeRate: jest.fn(),
    speakMessage: jest.fn(),
    stopSpeaking: jest.fn(),
  }),
}));
jest.mock("@/lib/analytics");
jest.mock("@/lib/offlineStorage");
jest.mock("@/lib/offlineReviewSync");
jest.mock("@/lib/chatExport");
jest.mock("@/components/VenueRatingDialog", () => ({
  VenueRatingDialog: () => null,
}));
jest.mock("@/components/VenueSubmissionModal", () => ({
  VenueSubmissionModal: () => null,
}));
jest.mock("@/components/chat/BookingModal", () => ({
  BookingModal: () => null,
}));
jest.mock("@/components/chat/ChatHeader", () => ({
  ChatHeader: ({ onToggleFilter }: { onToggleFilter: (f: string) => void }) => (
    <button type="button" onClick={() => onToggleFilter("wifi")}>
      toggle wifi filter
    </button>
  ),
}));
jest.mock("@/components/ui/ShortcutsModal", () => ({
  ShortcutsModal: () => null,
}));
jest.mock("@/components/chat/ChatMessages", () => ({
  MessageList: () => null,
  ChatInput: ({
    input,
    onInputChange,
    onSubmit,
  }: {
    input: string;
    onInputChange: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
  }) => (
    <form onSubmit={onSubmit} data-testid="chat-form">
      <input
        aria-label="message"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
      />
    </form>
  ),
}));

import { EnhancedChatbot } from "@/components/EnhancedChatbot";

function streamedChatResponse(venueCount: number) {
  const venues = Array.from({ length: venueCount }, (_, i) => ({
    id: `v${i}`,
    name: `Venue ${i}`,
    lat: 40.7,
    lng: -73.9,
    category: "cafe",
  }));
  const payload = new TextEncoder().encode(
    `METADATA:${JSON.stringify({ venues, agentSteps: [], suggestions: [] })}\n\nTEXT:ok`,
  );
  let sent = false;
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: payload };
        },
      }),
    },
  };
}

describe("EnhancedChatbot venue results live region (#7609)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (apiFetch as jest.Mock).mockImplementation(async (url: string) =>
      url === "/api/chat"
        ? streamedChatResponse(3)
        : { ok: false, status: 404, json: async () => ({}) },
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("announces the number of venues returned by a search", async () => {
    render(<EnhancedChatbot userLocation={{ lat: 40.7, lng: -73.9 }} />);
    const region = screen.getByTestId("venue-results-announcer");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");

    fireEvent.change(screen.getByLabelText("message"), {
      target: { value: "quiet cafes" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("chat-form"));
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(region).toHaveTextContent("Found 3 matching workspaces");
  });

  it("includes the number of active filters in the announcement", async () => {
    render(<EnhancedChatbot userLocation={{ lat: 40.7, lng: -73.9 }} />);
    const region = screen.getByTestId("venue-results-announcer");

    fireEvent.click(screen.getByText("toggle wifi filter"));
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    // Toggling a filter alone does not change the results, so nothing is read.
    expect(region).toHaveTextContent("");

    fireEvent.change(screen.getByLabelText("message"), {
      target: { value: "cafes with wifi" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("chat-form"));
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(region).toHaveTextContent(
      "Found 3 matching workspaces with 1 filter applied",
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        body: expect.stringContaining('"filters":{"wifi":true}'),
      }),
    );
  });
});
