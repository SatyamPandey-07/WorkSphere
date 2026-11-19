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
  ChatHeader: ({
    onToggleFilter,
    onClearFilters,
  }: {
    onToggleFilter: (f: string) => void;
    onClearFilters?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onToggleFilter("wifi")}>
        toggle wifi
      </button>
      <button type="button" onClick={() => onToggleFilter("quiet")}>
        toggle quiet
      </button>
      <button type="button" onClick={() => onClearFilters?.()}>
        clear all filters
      </button>
    </div>
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

const venuesResponse = (count: number) => ({
  ok: true,
  status: 200,
  json: async () => ({
    venues: Array.from({ length: count }, (_, i) => ({
      id: `r${i}`,
      name: `Refreshed ${i}`,
      latitude: 40.7,
      longitude: -73.9,
      category: "cafe",
    })),
  }),
});

describe("EnhancedChatbot clear-all filters (#7610)", () => {
  const onShowToast = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    (apiFetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url === "/api/chat") return streamedChatResponse(3);
      if (url.startsWith("/api/venues?")) return venuesResponse(5);
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const renderChatbot = () =>
    render(
      <EnhancedChatbot
        userLocation={{ lat: 40.7, lng: -73.9 }}
        onShowToast={onShowToast}
      />,
    );

  const search = async (text: string) => {
    fireEvent.change(screen.getByLabelText("message"), {
      target: { value: text },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("chat-form"));
    });
  };

  const venueRefreshCalls = () =>
    (apiFetch as jest.Mock).mock.calls.filter(([url]) =>
      String(url).startsWith("/api/venues?"),
    );

  it("clears filters and refreshes the current listing without them", async () => {
    renderChatbot();
    fireEvent.click(screen.getByText("toggle wifi"));
    fireEvent.click(screen.getByText("toggle quiet"));
    await search("quiet cafes with wifi");

    await act(async () => {
      fireEvent.click(screen.getByText("clear all filters"));
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(venueRefreshCalls()).toHaveLength(1);
    expect(venueRefreshCalls()[0][0]).toBe(
      "/api/venues?lat=40.7&lng=-73.9&radius=5000",
    );
    expect(screen.getByTestId("venue-results-announcer")).toHaveTextContent(
      "Found 5 matching workspaces",
    );
  });

  it("sends no filters with the next search after clearing", async () => {
    renderChatbot();
    fireEvent.click(screen.getByText("toggle wifi"));
    fireEvent.click(screen.getByText("toggle quiet"));
    await act(async () => {
      fireEvent.click(screen.getByText("clear all filters"));
    });
    await search("cafes");

    const chatCall = (apiFetch as jest.Mock).mock.calls.find(
      ([url]) => url === "/api/chat",
    );
    expect(JSON.parse(chatCall![1].body).filters).toBeUndefined();
  });

  it("does not request venues when there are no results to refresh", async () => {
    renderChatbot();
    fireEvent.click(screen.getByText("toggle wifi"));
    fireEvent.click(screen.getByText("toggle quiet"));

    await act(async () => {
      fireEvent.click(screen.getByText("clear all filters"));
    });

    expect(venueRefreshCalls()).toHaveLength(0);
  });

  it("shows a toast if the refresh after clearing fails", async () => {
    renderChatbot();
    fireEvent.click(screen.getByText("toggle wifi"));
    fireEvent.click(screen.getByText("toggle quiet"));
    await search("cafes");
    (apiFetch as jest.Mock).mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    await act(async () => {
      fireEvent.click(screen.getByText("clear all filters"));
    });

    expect(onShowToast).toHaveBeenCalledWith(
      "Filters cleared, but venues could not be refreshed.",
    );
  });
});
