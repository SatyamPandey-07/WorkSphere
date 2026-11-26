import React from "react";
import {
  render,
  screen,
  fireEvent,
  renderHook,
  act,
} from "@testing-library/react";
import { FloatingChatToggle } from "@/components/chat/FloatingChatToggle";
import {
  useChatChannel,
  getChatHistoryStorageKey,
  getStoredChatHistory,
} from "@/hooks/useChatChannel";

describe("FloatingChatToggle and useChatChannel (#9753, #9891)", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe("FloatingChatToggle component", () => {
    it("renders closed state with message icon and no badge when unreadCount is 0", () => {
      render(
        <FloatingChatToggle
          isOpen={false}
          onToggle={jest.fn()}
          unreadCount={0}
        />,
      );

      const button = screen.getByTestId("floating-chat-toggle");
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.queryByTestId("floating-chat-unread-badge"),
      ).not.toBeInTheDocument();
    });

    it("renders unread badge with exact count when closed and unreadCount > 0", () => {
      render(
        <FloatingChatToggle
          isOpen={false}
          onToggle={jest.fn()}
          unreadCount={5}
        />,
      );

      const badge = screen.getByTestId("floating-chat-unread-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("5");
    });

    it("clamps unread badge text to 99+ when unreadCount > 99", () => {
      render(
        <FloatingChatToggle
          isOpen={false}
          onToggle={jest.fn()}
          unreadCount={120}
        />,
      );

      const badge = screen.getByTestId("floating-chat-unread-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("99+");
    });

    it("does not display badge when drawer is open even if unreadCount > 0", () => {
      render(
        <FloatingChatToggle
          isOpen={true}
          onToggle={jest.fn()}
          unreadCount={5}
        />,
      );

      expect(
        screen.queryByTestId("floating-chat-unread-badge"),
      ).not.toBeInTheDocument();
    });

    it("fires onToggle callback when button is clicked", () => {
      const onToggle = jest.fn();
      render(<FloatingChatToggle isOpen={false} onToggle={onToggle} />);

      fireEvent.click(screen.getByTestId("floating-chat-toggle"));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("displays subtle inline system notice when drawer is open and system note is present", () => {
      const messages = [
        {
          id: "sys-1",
          senderName: "System",
          content: "Chat history cleared locally.",
          timestamp: Date.now(),
          isSystem: true,
        },
      ];
      render(
        <FloatingChatToggle
          isOpen={true}
          onToggle={jest.fn()}
          messages={messages}
        />,
      );

      const notice = screen.getByTestId("floating-chat-system-notice");
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveTextContent("Chat history cleared locally.");
    });

    it("does not display system notice banner when drawer is closed", () => {
      const messages = [
        {
          id: "sys-1",
          senderName: "System",
          content: "Chat history cleared locally.",
          timestamp: Date.now(),
          isSystem: true,
        },
      ];
      render(
        <FloatingChatToggle
          isOpen={false}
          onToggle={jest.fn()}
          messages={messages}
        />,
      );

      expect(
        screen.queryByTestId("floating-chat-system-notice"),
      ).not.toBeInTheDocument();
    });
  });

  describe("useChatChannel hook", () => {
    it("initializes with default closed state and zero unread count", () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: "test-room" }),
      );

      expect(result.current.isOpen).toBe(false);
      expect(result.current.unreadCount).toBe(0);
      expect(result.current.messages).toEqual([]);
    });

    it("increments unread count when incoming message timestamp is greater than lastReadTimestamp and drawer is closed", () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: "room-1", currentUserId: "user-1" }),
      );

      act(() => {
        result.current.onIncomingMessage({
          id: "msg-1",
          senderId: "user-2",
          content: "Hello",
          timestamp: Date.now() + 1000,
        });
      });

      expect(result.current.unreadCount).toBe(1);

      act(() => {
        result.current.onIncomingMessage({
          id: "msg-2",
          senderId: "user-2",
          content: "Another message",
          timestamp: Date.now() + 2000,
        });
      });

      expect(result.current.unreadCount).toBe(2);
    });

    it("does not increment unread count for messages sent by the current user", () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: "room-1", currentUserId: "user-1" }),
      );

      act(() => {
        result.current.onIncomingMessage({
          id: "msg-self",
          senderId: "user-1",
          content: "My message",
          timestamp: Date.now() + 1000,
        });
      });

      expect(result.current.unreadCount).toBe(0);
    });

    it("clears unread count and updates lastReadTimestamp when drawer is opened", () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: "room-1", currentUserId: "user-1" }),
      );

      act(() => {
        result.current.onIncomingMessage({
          id: "msg-1",
          senderId: "user-2",
          content: "Hello",
          timestamp: Date.now() + 1000,
        });
      });

      expect(result.current.unreadCount).toBe(1);

      act(() => {
        result.current.openChat();
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.unreadCount).toBe(0);
    });

    it("does not increment unread count when drawer is open", () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: "room-1", initialIsOpen: true }),
      );

      act(() => {
        result.current.onIncomingMessage({
          id: "msg-open",
          senderId: "user-2",
          content: "While open",
          timestamp: Date.now() + 1000,
        });
      });

      expect(result.current.unreadCount).toBe(0);
    });
  });

  describe("Issue #9891 — Slash command /clear handling", () => {
    it("submitting /clear intercepts the command and returns true", () => {
      const mockBroadcast = jest.fn();
      const { result } = renderHook(() =>
        useChatChannel({
          roomId: "room-clear",
          currentUserId: "user-1",
          onBroadcastMessage: mockBroadcast,
        }),
      );

      let intercepted: boolean | undefined;
      act(() => {
        intercepted = result.current.sendMessage("/clear");
      });

      expect(intercepted).toBe(true);
    });

    it("/clear is not added to the normal message list and is not broadcast to room peers", () => {
      const mockBroadcast = jest.fn();
      const { result } = renderHook(() =>
        useChatChannel({
          roomId: "room-clear",
          currentUserId: "user-1",
          onBroadcastMessage: mockBroadcast,
        }),
      );

      act(() => {
        result.current.sendMessage("First regular message");
      });
      expect(mockBroadcast).toHaveBeenCalledTimes(1);

      mockBroadcast.mockClear();

      act(() => {
        result.current.sendMessage("/clear");
      });

      expect(mockBroadcast).not.toHaveBeenCalled();
      const hasNormalClearMessage = result.current.messages.some(
        (m) => m.content === "/clear" && !m.isSystem,
      );
      expect(hasNormalClearMessage).toBe(false);
    });

    it("current channel messages are cleared from React state and inline system note appears", () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: "room-clear", currentUserId: "user-1" }),
      );

      act(() => {
        result.current.sendMessage("Message 1");
        result.current.sendMessage("Message 2");
      });
      expect(result.current.messages.length).toBe(2);

      act(() => {
        result.current.sendMessage("/clear");
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].content).toBe(
        "Chat history cleared locally.",
      );
      expect(result.current.messages[0].isSystem).toBe(true);
      expect(result.current.messages[0].senderName).toBe("System");
    });

    it("current channel history is removed from local persistence", () => {
      const roomId = "room-persisted";
      const userId = "user-1";
      const storageKey = getChatHistoryStorageKey(roomId, userId);

      const { result } = renderHook(() =>
        useChatChannel({ roomId, currentUserId: userId }),
      );

      act(() => {
        result.current.sendMessage("Message to persist");
      });

      expect(localStorage.getItem(storageKey)).not.toBeNull();
      const storedBefore = JSON.parse(localStorage.getItem(storageKey) || "[]");
      expect(storedBefore.length).toBe(1);

      act(() => {
        result.current.sendMessage("/clear");
      });

      expect(localStorage.getItem(storageKey)).toBeNull();
      expect(getStoredChatHistory(roomId, userId)).toEqual([]);
    });

    it("cleared history does not reappear after component remount or reload", () => {
      const roomId = "room-reload-test";
      const userId = "user-1";

      const { result, unmount } = renderHook(() =>
        useChatChannel({ roomId, currentUserId: userId }),
      );

      act(() => {
        result.current.sendMessage("Message to be cleared");
      });
      act(() => {
        result.current.sendMessage("/clear");
      });

      unmount();

      const { result: remounted } = renderHook(() =>
        useChatChannel({ roomId, currentUserId: userId }),
      );

      expect(remounted.current.messages).toEqual([]);
    });

    it("unread count resets to 0 upon executing /clear", () => {
      const { result } = renderHook(() =>
        useChatChannel({
          roomId: "room-unread-test",
          currentUserId: "user-1",
          initialIsOpen: false,
        }),
      );

      act(() => {
        result.current.onIncomingMessage({
          id: "msg-remote-1",
          senderId: "user-remote",
          content: "Hello unread",
          timestamp: Date.now() + 1000,
        });
      });
      expect(result.current.unreadCount).toBe(1);

      act(() => {
        result.current.sendMessage("/clear");
      });

      expect(result.current.unreadCount).toBe(0);
    });

    it("does not clear other channels message history or unread counts", () => {
      const channelA = "channel-A";
      const channelB = "channel-B";
      const userId = "user-multi";

      const { result: resA } = renderHook(() =>
        useChatChannel({ roomId: channelA, currentUserId: userId }),
      );
      const { result: resB } = renderHook(() =>
        useChatChannel({ roomId: channelB, currentUserId: userId }),
      );

      act(() => {
        resA.current.sendMessage("Channel A message");
        resB.current.sendMessage("Channel B message");
      });

      expect(getStoredChatHistory(channelA, userId).length).toBe(1);
      expect(getStoredChatHistory(channelB, userId).length).toBe(1);

      act(() => {
        resA.current.sendMessage("/clear");
      });

      // Channel A is cleared
      expect(getStoredChatHistory(channelA, userId)).toEqual([]);
      expect(resA.current.messages[0].content).toBe(
        "Chat history cleared locally.",
      );

      // Channel B is preserved
      expect(getStoredChatHistory(channelB, userId).length).toBe(1);
      expect(resB.current.messages.length).toBe(1);
      expect(resB.current.messages[0].content).toBe("Channel B message");
    });

    it("handles leading/trailing whitespace and case insensitivity", () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: "room-case", currentUserId: "user-1" }),
      );

      act(() => {
        result.current.sendMessage("Existing message");
      });

      let intercepted = false;
      act(() => {
        intercepted = result.current.sendMessage("   /CLEAR   ");
      });

      expect(intercepted).toBe(true);
      expect(result.current.messages[0].content).toBe(
        "Chat history cleared locally.",
      );

      act(() => {
        intercepted = result.current.sendMessage("  /Clear  ");
      });
      expect(intercepted).toBe(true);
    });

    it("handles repeated /clear commands safely without errors", () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: "room-repeated", currentUserId: "user-1" }),
      );

      expect(() => {
        act(() => {
          result.current.sendMessage("/clear");
          result.current.sendMessage("/clear");
          result.current.sendMessage("   /clear   ");
        });
      }).not.toThrow();

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].content).toBe(
        "Chat history cleared locally.",
      );
      expect(result.current.unreadCount).toBe(0);
    });

    it("normal messages still submit and broadcast normally", () => {
      const mockBroadcast = jest.fn();
      const { result } = renderHook(() =>
        useChatChannel({
          roomId: "room-normal",
          currentUserId: "user-1",
          onBroadcastMessage: mockBroadcast,
        }),
      );

      let intercepted = false;
      act(() => {
        intercepted = result.current.sendMessage("Hello normal chat");
      });

      expect(intercepted).toBe(false);
      expect(mockBroadcast).toHaveBeenCalledTimes(1);
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Hello normal chat",
          roomId: "room-normal",
          senderId: "user-1",
        }),
      );
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].content).toBe("Hello normal chat");
    });

    it("direct invocation of clearChatHistory resets state, persistence, and sets system note", () => {
      const { result } = renderHook(() =>
        useChatChannel({
          roomId: "room-direct-clear",
          currentUserId: "user-1",
        }),
      );

      act(() => {
        result.current.sendMessage("Some msg");
      });
      expect(result.current.messages.length).toBe(1);

      act(() => {
        result.current.clearChatHistory();
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].content).toBe(
        "Chat history cleared locally.",
      );
      expect(result.current.unreadCount).toBe(0);
      expect(getStoredChatHistory("room-direct-clear", "user-1")).toEqual([]);
    });

    it("Issue #10122 — ensures clear-and-resend lifecycle creates unique keys and starts fresh grouping", () => {
      const mockBroadcast = jest.fn();
      const { result } = renderHook(() =>
        useChatChannel({
          roomId: "room-timestamp-lifecycle",
          currentUserId: "user-1",
          onBroadcastMessage: mockBroadcast,
        }),
      );

      // 1. Send first message: "Hello"
      act(() => {
        result.current.sendMessage("Hello");
      });

      expect(result.current.messages).toHaveLength(1);
      const firstMsg = result.current.messages[0];
      expect(firstMsg.content).toBe("Hello");
      expect(firstMsg.id).toBeDefined();
      expect(firstMsg.timestamp).toBeGreaterThan(0);

      // 2. Execute /clear
      act(() => {
        result.current.sendMessage("/clear");
      });

      // Old message is cleared; system notice present
      expect(result.current.messages).toHaveLength(1);
      const clearNotice = result.current.messages[0];
      expect(clearNotice.isSystem).toBe(true);
      expect(clearNotice.content).toBe("Chat history cleared locally.");
      expect(clearNotice.id).not.toBe(firstMsg.id);

      // 3. Send new message: "Hello again"
      act(() => {
        result.current.sendMessage("Hello again");
      });

      // System note and new message are present
      expect(result.current.messages).toHaveLength(2);
      const secondMsg = result.current.messages[1];
      expect(secondMsg.content).toBe("Hello again");
      expect(secondMsg.id).toBeDefined();
      expect(secondMsg.id).not.toBe(firstMsg.id);
      expect(secondMsg.id).not.toBe(clearNotice.id);
      expect(secondMsg.timestamp).toBeGreaterThanOrEqual(firstMsg.timestamp);

      // Verify broadcast was only called for normal messages (not /clear)
      expect(mockBroadcast).toHaveBeenCalledTimes(2);
      expect(mockBroadcast).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ content: "Hello" }),
      );
      expect(mockBroadcast).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ content: "Hello again" }),
      );

      // Verify incoming message with same ID as cleared message is properly processed due to reset deduplication ref
      act(() => {
        result.current.onIncomingMessage({
          id: firstMsg.id,
          senderId: "user-2",
          content: "Reprocessed message",
          timestamp: Date.now() + 5000,
        });
      });

      expect(result.current.messages).toHaveLength(3);
      expect(result.current.messages[2].content).toBe("Reprocessed message");
    });
  });
});
