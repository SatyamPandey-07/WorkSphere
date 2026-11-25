import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  formatUnreadCount,
  getStoredUnreadCount,
  setStoredUnreadCount,
  markRoomAsRead,
  useUnreadMessageTracking,
  UNREAD_MESSAGES_CHANGED_EVENT,
} from "@/lib/chat/unreadTracker";
import { ChatUnreadBadge } from "@/components/chat/ChatUnreadBadge";
import { ChatInput } from "@/components/chat/ChatInput";
import { TopNav } from "@/components/TopNav";

// Mock Clerk useUser
const mockUser = {
  id: "user-123",
  firstName: "Alex",
};

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isSignedIn: true,
    user: mockUser,
  }),
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
  UserButton: () => <div data-testid="mock-user-button">UserButton</div>,
}));

// Mock next/navigation
let currentMockPathname = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => currentMockPathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe("Unread Message Tracking & Badge System (#9607)", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    currentMockPathname = "/";
  });

  describe("formatUnreadCount utility", () => {
    it("returns empty string for 0 or negative numbers", () => {
      expect(formatUnreadCount(0)).toBe("");
      expect(formatUnreadCount(-5)).toBe("");
    });

    it("returns exact numerical string for counts between 1 and 99", () => {
      expect(formatUnreadCount(1)).toBe("1");
      expect(formatUnreadCount(42)).toBe("42");
      expect(formatUnreadCount(99)).toBe("99");
    });

    it("returns '99+' for counts greater than 99", () => {
      expect(formatUnreadCount(100)).toBe("99+");
      expect(formatUnreadCount(999)).toBe("99+");
    });
  });

  describe("ChatUnreadBadge Component", () => {
    it("renders nothing when count is 0", () => {
      const { container } = render(<ChatUnreadBadge count={0} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders exact count for 1 to 99", () => {
      render(<ChatUnreadBadge count={7} />);
      const badge = screen.getByTestId("chat-unread-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("7");
    });

    it("renders 99+ when count exceeds 99", () => {
      render(<ChatUnreadBadge count={150} />);
      const badge = screen.getByTestId("chat-unread-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("99+");
    });

    it("updates reactively when UNREAD_MESSAGES_CHANGED_EVENT fires", () => {
      render(<ChatUnreadBadge roomId="room-tokyo" />);
      expect(screen.queryByTestId("chat-unread-badge")).not.toBeInTheDocument();

      act(() => {
        window.dispatchEvent(
          new CustomEvent(UNREAD_MESSAGES_CHANGED_EVENT, {
            detail: { roomId: "room-tokyo", count: 5 },
          }),
        );
      });

      expect(screen.getByTestId("chat-unread-badge")).toHaveTextContent("5");

      act(() => {
        window.dispatchEvent(
          new CustomEvent(UNREAD_MESSAGES_CHANGED_EVENT, {
            detail: { roomId: "room-tokyo", count: 0 },
          }),
        );
      });

      expect(screen.queryByTestId("chat-unread-badge")).not.toBeInTheDocument();
    });
  });

  describe("useUnreadMessageTracking hook behavior", () => {
    function TestTrackingComponent({
      roomId = "default",
      currentUserId = "user-123",
      currentUserName = "Alex",
      isChatOpen = false,
    }) {
      const { unreadCount, processIncomingMessage, clearUnread } =
        useUnreadMessageTracking({
          roomId,
          currentUserId,
          currentUserName,
          isChatOpen,
        });

      return (
        <div>
          <span data-testid="hook-unread-count">{unreadCount}</span>
          <button
            data-testid="simulate-msg-btn"
            onClick={() =>
              processIncomingMessage({
                id: "msg-" + Date.now() + "-" + Math.random(),
                senderId: "other-user-999",
                senderName: "Bob",
                timestamp: Date.now(),
                roomId,
              })
            }
          >
            Simulate Incoming
          </button>
          <button
            data-testid="simulate-self-btn"
            onClick={() =>
              processIncomingMessage({
                id: "self-" + Date.now(),
                senderId: "user-123",
                senderName: "Alex",
                timestamp: Date.now(),
                roomId,
              })
            }
          >
            Simulate Self
          </button>
          <button
            data-testid="simulate-dup-btn"
            onClick={() =>
              processIncomingMessage({
                id: "fixed-dup-id",
                senderId: "other-user-999",
                senderName: "Bob",
                timestamp: Date.now(),
                roomId,
              })
            }
          >
            Simulate Duplicate
          </button>
          <button data-testid="clear-btn" onClick={clearUnread}>
            Clear
          </button>
        </div>
      );
    }

    it("increments unread count for incoming messages from others when chat is closed", () => {
      render(<TestTrackingComponent isChatOpen={false} />);
      expect(screen.getByTestId("hook-unread-count")).toHaveTextContent("0");

      fireEvent.click(screen.getByTestId("simulate-msg-btn"));
      expect(screen.getByTestId("hook-unread-count")).toHaveTextContent("1");

      fireEvent.click(screen.getByTestId("simulate-msg-btn"));
      expect(screen.getByTestId("hook-unread-count")).toHaveTextContent("2");
    });

    it("excludes messages sent by the current user", () => {
      render(<TestTrackingComponent isChatOpen={false} />);
      expect(screen.getByTestId("hook-unread-count")).toHaveTextContent("0");

      fireEvent.click(screen.getByTestId("simulate-self-btn"));
      expect(screen.getByTestId("hook-unread-count")).toHaveTextContent("0");
    });

    it("deduplicates message events with the same message id", () => {
      render(<TestTrackingComponent isChatOpen={false} />);
      expect(screen.getByTestId("hook-unread-count")).toHaveTextContent("0");

      fireEvent.click(screen.getByTestId("simulate-dup-btn"));
      expect(screen.getByTestId("hook-unread-count")).toHaveTextContent("1");

      // Click again with exact same ID
      fireEvent.click(screen.getByTestId("simulate-dup-btn"));
      expect(screen.getByTestId("hook-unread-count")).toHaveTextContent("1");
    });

    it("persists unread count and last read timestamp to localStorage", () => {
      render(<TestTrackingComponent roomId="room-alpha" currentUserId="user-123" isChatOpen={false} />);

      fireEvent.click(screen.getByTestId("simulate-msg-btn"));
      expect(getStoredUnreadCount("room-alpha", "user-123")).toBe(1);

      fireEvent.click(screen.getByTestId("clear-btn"));
      expect(getStoredUnreadCount("room-alpha", "user-123")).toBe(0);
    });

    it("isolates unread counts across different rooms", () => {
      setStoredUnreadCount(3, "room-A", "user-123");
      setStoredUnreadCount(7, "room-B", "user-123");

      expect(getStoredUnreadCount("room-A", "user-123")).toBe(3);
      expect(getStoredUnreadCount("room-B", "user-123")).toBe(7);

      markRoomAsRead("room-A", "user-123");
      expect(getStoredUnreadCount("room-A", "user-123")).toBe(0);
      expect(getStoredUnreadCount("room-B", "user-123")).toBe(7);
    });

    it("automatically resets count when isChatOpen is true", () => {
      setStoredUnreadCount(4, "default", "user-123");
      render(<TestTrackingComponent isChatOpen={true} />);

      expect(screen.getByTestId("hook-unread-count")).toHaveTextContent("0");
      expect(getStoredUnreadCount("default", "user-123")).toBe(0);
    });
  });

  describe("ChatInput focus reset behavior", () => {
    it("clears room unread count when ChatInput is focused", () => {
      setStoredUnreadCount(5, "room-shibuya", "user-123");
      expect(getStoredUnreadCount("room-shibuya", "user-123")).toBe(5);

      const onFocusMock = jest.fn();
      render(
        <ChatInput
          roomId="room-shibuya"
          userId="user-123"
          input=""
          isLoading={false}
          onInputChange={jest.fn()}
          onSubmit={jest.fn()}
          onFocus={onFocusMock}
        />,
      );

      const input = screen.getByPlaceholderText("Where's the focus mode hotspot?");
      fireEvent.focus(input);

      expect(onFocusMock).toHaveBeenCalledTimes(1);
      expect(getStoredUnreadCount("room-shibuya", "user-123")).toBe(0);
    });
  });

  describe("TopNav unread badge integration", () => {
    it("displays unread count badge on Discover link when count > 0", () => {
      setStoredUnreadCount(4, "default", "user-123");

      render(<TopNav />);

      const discoverLinks = screen.getAllByRole("link", { name: /Discover/i });
      expect(discoverLinks.length).toBeGreaterThan(0);

      // Look for the rendered badge
      const badges = screen.getAllByTestId("chat-unread-badge");
      expect(badges.length).toBeGreaterThan(0);
      expect(badges[0]).toHaveTextContent("4");

      // Accessible description exposed on link
      expect(discoverLinks[0]).toHaveAttribute(
        "aria-label",
        "Discover (4 unread chat messages)",
      );
    });

    it("hides badge when unread count is 0", () => {
      setStoredUnreadCount(0, "default", "user-123");

      render(<TopNav />);

      expect(screen.queryByTestId("chat-unread-badge")).not.toBeInTheDocument();
    });
  });
});
