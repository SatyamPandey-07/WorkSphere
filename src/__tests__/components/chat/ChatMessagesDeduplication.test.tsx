/**
 * ChatMessagesDeduplication.test.tsx
 *
 * Unit tests verifying chat message deduplication during rapid WebRTC DataChannel reconnects (#10014).
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MessageList,
  Message,
  deduplicateChatMessages,
} from "@/components/chat/ChatMessages";

// Mocks for auxiliary hooks and components
jest.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: "",
    startListening: jest.fn(),
    stopListening: jest.fn(),
    resetTranscript: jest.fn(),
    hasSupport: false,
  }),
}));

jest.mock("@/hooks/useSpeechSynthesis", () => ({
  useSpeechSynthesis: () => ({
    speak: jest.fn(),
    cancel: jest.fn(),
    speaking: false,
    supported: false,
    speakingMessageId: null,
    speakingSentenceIndex: null,
  }),
}));

jest.mock("@/components/chat/BrainTerminal", () => ({
  BrainTerminal: () => <div data-testid="BrainTerminal" />,
}));

jest.mock("@/components/chat/GenerativeUI", () => ({
  MessageRenderer: ({ content }: { content: string }) => (
    <div data-testid="MessageRenderer">{content}</div>
  ),
}));

jest.mock("@/components/chat/TranslatedMessage", () => ({
  TranslatedMessage: ({ text }: { text: string }) => (
    <div data-testid="TranslatedMessage">{text}</div>
  ),
}));

jest.mock("@/components/collections/AddToFolderModal", () => ({
  AddToFolderModal: () => <div data-testid="AddToFolderModal" />,
}));

jest.mock("@/components/ui/EmptyState", () => ({
  EmptyState: () => <div data-testid="EmptyState" />,
}));

jest.mock("@/components/ComparisonDrawer", () => ({
  ComparisonDrawer: () => <div data-testid="ComparisonDrawer" />,
}));

jest.mock("@/components/ui/skeleton", () => ({
  ChatMessageSkeleton: () => <div data-testid="ChatMessageSkeleton" />,
}));

jest.mock("@/components/ui/VenueGrid", () => ({
  VenueGrid: () => <div data-testid="VenueGrid" />,
  LayoutBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SubgridCell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("ChatMessages WebRTC Reconnect Deduplication (#10014)", () => {
  describe("deduplicateChatMessages", () => {
    it("returns empty array when provided with non-array input", () => {
      // @ts-expect-error testing invalid input
      expect(deduplicateChatMessages(null)).toEqual([]);
      // @ts-expect-error testing invalid input
      expect(deduplicateChatMessages(undefined)).toEqual([]);
    });

    it("filters out falsy or empty-id messages", () => {
      const msgs = [
        // @ts-expect-error testing invalid message
        null,
        { id: "", role: "user", content: "Empty ID" },
        { id: "valid-1", role: "user", content: "First message" },
      ] as Message[];

      const result = deduplicateChatMessages(msgs);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("valid-1");
    });

    it("deduplicates messages while preserving order and first occurrence", () => {
      const msgs: Message[] = [
        { id: "msg-1", role: "user", content: "Hello" },
        { id: "msg-2", role: "assistant", content: "Welcome!" },
        { id: "msg-1", role: "user", content: "Hello duplicate" },
        { id: "msg-3", role: "user", content: "Looking for a desk" },
        { id: "msg-2", role: "assistant", content: "Welcome! duplicate" },
      ];

      const result = deduplicateChatMessages(msgs);
      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id)).toEqual(["msg-1", "msg-2", "msg-3"]);
      expect(result[0].content).toBe("Hello");
      expect(result[1].content).toBe("Welcome!");
    });
  });

  describe("MessageList component rendering", () => {
    const defaultProps = {
      isLoading: false,
      error: null,
      expandedSteps: {},
      favorites: new Set<string>(),
      messagesEndRef: React.createRef<HTMLDivElement>(),
      onToggleSteps: jest.fn(),
      onGetDirections: jest.fn(),
      onToggleFavorite: jest.fn(),
      onRateVenue: jest.fn(),
      onOpenDetails: jest.fn(),
      onBook: jest.fn(),
      onSuggestionClick: jest.fn(),
      initialSuggestions: ["Quiet cafe", "Open workspace"],
      onRefreshVenues: jest.fn(),
    };

    it("renders exactly one message bubble per unique message id even when input contains duplicates", () => {
      const duplicateMessages: Message[] = [
        {
          id: "rtc-msg-101",
          role: "user",
          content: "Is high-speed wifi available?",
        },
        {
          id: "rtc-msg-102",
          role: "assistant",
          content: "Yes, 300 Mbps fiber is verified.",
        },
        // Duplicates received from WebRTC DataChannel reconnect sync
        {
          id: "rtc-msg-101",
          role: "user",
          content: "Is high-speed wifi available?",
        },
        {
          id: "rtc-msg-102",
          role: "assistant",
          content: "Yes, 300 Mbps fiber is verified.",
        },
        {
          id: "rtc-msg-103",
          role: "user",
          content: "Great, booking a seat now.",
        },
      ];

      render(<MessageList {...defaultProps} messages={duplicateMessages} />);

      // Exactly 1 bubble for each message id
      expect(screen.getAllByTestId("chat-message-rtc-msg-101")).toHaveLength(1);
      expect(screen.getAllByTestId("chat-message-rtc-msg-102")).toHaveLength(1);
      expect(screen.getAllByTestId("chat-message-rtc-msg-103")).toHaveLength(1);

      // Total rendered message bubbles in DOM must be 3, not 5
      const allRendered = screen.getAllByTestId(/^chat-message-/);
      expect(allRendered).toHaveLength(3);
    });

    it("handles rapid re-renders with incoming re-transmitted chunks gracefully", () => {
      const initialMessages: Message[] = [
        { id: "msg-a", role: "user", content: "Connecting peer..." },
      ];

      const { rerender } = render(
        <MessageList {...defaultProps} messages={initialMessages} />,
      );

      expect(screen.getAllByTestId("chat-message-msg-a")).toHaveLength(1);

      // Peer reconnects and re-sends history + 1 new message
      const reconnectedMessages: Message[] = [
        { id: "msg-a", role: "user", content: "Connecting peer..." },
        { id: "msg-a", role: "user", content: "Connecting peer..." },
        {
          id: "msg-b",
          role: "assistant",
          content: "Peer connection restored!",
        },
      ];

      rerender(
        <MessageList {...defaultProps} messages={reconnectedMessages} />,
      );

      expect(screen.getAllByTestId("chat-message-msg-a")).toHaveLength(1);
      expect(screen.getAllByTestId("chat-message-msg-b")).toHaveLength(1);
      expect(screen.getAllByTestId(/^chat-message-/)).toHaveLength(2);
    });
  });
});
