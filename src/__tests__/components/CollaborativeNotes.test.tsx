/**
 * CollaborativeNotes (#3438): active typing presence indicators and CRDT notes.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as Y from "yjs";
import { CollaborativeNotes } from "@/components/collections/CollaborativeNotes";

type Handler = (arg: unknown) => void;

class FakeYPartyKitProvider {
  static last: FakeYPartyKitProvider;
  handlers: Record<string, Handler[]> = {};

  constructor(
    public host: string,
    public room: string,
    public doc: Y.Doc,
    public options: { params: () => Promise<Record<string, string>> },
  ) {
    FakeYPartyKitProvider.last = this;
  }

  on(event: string, fn: Handler) {
    (this.handlers[event] ??= []).push(fn);
  }

  off(event: string, fn: Handler) {
    this.handlers[event] = (this.handlers[event] ?? []).filter((h) => h !== fn);
  }

  emit(event: string, arg: unknown) {
    (this.handlers[event] ?? []).forEach((h) => h(arg));
  }

  destroy() {}
}

jest.mock("y-partykit/provider", () => ({
  __esModule: true,
  default: jest.fn(
    (...args: unknown[]) => new (FakeYPartyKitProvider as any)(...args),
  ),
}));

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue("clerk-token") }),
  useUser: () => ({
    user: {
      id: "local-user-1",
      fullName: "Alice Tester",
      imageUrl: "https://example.com/alice.png",
    },
  }),
}));

const mockSocketSend = jest.fn();
const sharedSocketInstance = {
  options: {} as {
    host: string;
    room: string;
    onOpen?: () => void;
    onMessage?: (event: { data: string }) => void;
  },
  send: mockSocketSend,
  readyState: 1, // WebSocket.OPEN
  close: jest.fn(),
};

let latestSocket: typeof sharedSocketInstance | null = null;

jest.mock("partysocket/react", () => {
  return jest.fn((options) => {
    sharedSocketInstance.options = options;
    latestSocket = sharedSocketInstance;
    return sharedSocketInstance;
  });
});

const fetchMock = jest.fn().mockResolvedValue({ ok: true });

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockClear();
  mockSocketSend.mockClear();
  sharedSocketInstance.close.mockClear();
  latestSocket = null;
  global.fetch = fetchMock as unknown as typeof fetch;
  global.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("CollaborativeNotes Active Typing Presence (#3438)", () => {
  it("initializes PartySocket, announces presence on open, and requests presence state", () => {
    render(
      <CollaborativeNotes
        folderId="folder-101"
        initialText="Team notes"
        canEdit={true}
      />,
    );

    expect(latestSocket).not.toBeNull();
    expect(latestSocket?.options.room).toBe("folder-notes-folder-101");

    // Simulate socket open event
    act(() => {
      latestSocket?.options.onOpen?.();
    });

    expect(mockSocketSend).toHaveBeenCalledTimes(2);
    const firstCall = JSON.parse(mockSocketSend.mock.calls[0][0]);
    expect(firstCall).toMatchObject({
      type: "presence_update",
      userId: "local-user-1",
      userName: "Alice Tester",
      avatarUrl: "https://example.com/alice.png",
      cursorPosition: null,
      isTyping: false,
    });
    expect(typeof firstCall.lastActive).toBe("number");

    expect(mockSocketSend).toHaveBeenCalledWith(
      JSON.stringify({ type: "request_presence" }),
    );
  });

  it("sends a presence heartbeat every 5 seconds while active", () => {
    render(<CollaborativeNotes folderId="folder-101" />);

    // Clear initial calls
    mockSocketSend.mockClear();

    // Advance by 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockSocketSend).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(mockSocketSend.mock.calls[0][0]);
    expect(sent).toMatchObject({
      type: "presence_heartbeat",
      userId: "local-user-1",
      userName: "Alice Tester",
      isTyping: false,
    });

    // Advance by another 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockSocketSend).toHaveBeenCalledTimes(2);
  });

  it("renders collaborator avatar chips with green active indicator dots", () => {
    render(<CollaborativeNotes folderId="folder-101" />);

    // Peer connects and sends presence_update
    act(() => {
      latestSocket?.options.onMessage?.({
        data: JSON.stringify({
          type: "presence_update",
          userId: "user-2",
          userName: "Bob Builder",
          avatarUrl: "https://example.com/bob.png",
          cursorPosition: 10,
          isTyping: false,
          lastActive: Date.now(),
        }),
      });
    });

    // Bob should be in collaborators list
    expect(screen.getByTestId("collaborator-user-2")).toBeInTheDocument();
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();

    // Green indicator dot should be visible
    expect(screen.getByTestId("active-dot-user-2")).toBeInTheDocument();

    // Typing bubble should NOT be displayed when isTyping is false
    expect(screen.queryByTestId("typing-bubble-user-2")).not.toBeInTheDocument();
  });

  it("displays typing bubble and typing banner when collaborator is typing", () => {
    render(<CollaborativeNotes folderId="folder-101" />);

    // Bob starts typing
    act(() => {
      latestSocket?.options.onMessage?.({
        data: JSON.stringify({
          type: "presence_update",
          userId: "user-2",
          userName: "Bob Builder",
          avatarUrl: "https://example.com/bob.png",
          cursorPosition: 15,
          isTyping: true,
          lastActive: Date.now(),
        }),
      });
    });

    // Typing bubble appears inside Bob's chip
    expect(screen.getByTestId("typing-bubble-user-2")).toBeInTheDocument();

    // Typing banner appears
    expect(screen.getByTestId("typing-banner")).toBeInTheDocument();
    expect(screen.getByText(/Bob Builder is typing…/i)).toBeInTheDocument();

    // Bob stops typing
    act(() => {
      latestSocket?.options.onMessage?.({
        data: JSON.stringify({
          type: "presence_update",
          userId: "user-2",
          userName: "Bob Builder",
          avatarUrl: "https://example.com/bob.png",
          cursorPosition: 20,
          isTyping: false,
          lastActive: Date.now(),
        }),
      });
    });

    // Typing indicators disappear
    expect(screen.queryByTestId("typing-bubble-user-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("typing-banner")).not.toBeInTheDocument();
  });

  it("removes collaborator chip when presence_remove message is received", () => {
    render(<CollaborativeNotes folderId="folder-101" />);

    // Add Bob
    act(() => {
      latestSocket?.options.onMessage?.({
        data: JSON.stringify({
          type: "presence_update",
          userId: "user-2",
          userName: "Bob Builder",
          isTyping: false,
          lastActive: Date.now(),
        }),
      });
    });
    expect(screen.getByTestId("collaborator-user-2")).toBeInTheDocument();

    // Bob drops or disconnects
    act(() => {
      latestSocket?.options.onMessage?.({
        data: JSON.stringify({
          type: "presence_remove",
          userId: "user-2",
        }),
      });
    });

    expect(screen.queryByTestId("collaborator-user-2")).not.toBeInTheDocument();
  });

  it("broadcasts isTyping: true on local change and resets after debounce timeout", () => {
    render(<CollaborativeNotes folderId="folder-101" canEdit={true} />);

    mockSocketSend.mockClear();

    const textarea = screen.getByRole("textbox", { name: "Collection notes" });

    // Local user types into textarea
    fireEvent.change(textarea, { target: { value: "Hello world" } });

    // Should immediately broadcast isTyping: true
    expect(mockSocketSend).toHaveBeenCalledTimes(1);
    const typingCall = JSON.parse(mockSocketSend.mock.calls[0][0]);
    expect(typingCall).toMatchObject({
      type: "presence_update",
      userId: "local-user-1",
      userName: "Alice Tester",
      avatarUrl: "https://example.com/alice.png",
      cursorPosition: 11,
      isTyping: true,
    });
    expect(typeof typingCall.lastActive).toBe("number");

    mockSocketSend.mockClear();

    // Fast-forward debounce period (2500ms)
    act(() => {
      jest.advanceTimersByTime(2500);
    });

    // Should broadcast isTyping: false
    expect(mockSocketSend).toHaveBeenCalledTimes(1);
    const idleCall = JSON.parse(mockSocketSend.mock.calls[0][0]);
    expect(idleCall).toMatchObject({
      type: "presence_update",
      userId: "local-user-1",
      userName: "Alice Tester",
      avatarUrl: "https://example.com/alice.png",
      isTyping: false,
    });
    expect(typeof idleCall.lastActive).toBe("number");
  });

  it("handles initial presence_state bulk snapshot", () => {
    render(<CollaborativeNotes folderId="folder-101" />);

    act(() => {
      latestSocket?.options.onMessage?.({
        data: JSON.stringify({
          type: "presence_state",
          users: [
            {
              userId: "user-2",
              userName: "Bob",
              isTyping: false,
              lastActive: Date.now(),
            },
            {
              userId: "user-3",
              userName: "Charlie",
              isTyping: true,
              lastActive: Date.now(),
            },
          ],
        }),
      });
    });

    expect(screen.getByTestId("collaborator-user-2")).toBeInTheDocument();
    expect(screen.getByTestId("collaborator-user-3")).toBeInTheDocument();
    expect(screen.getByTestId("typing-bubble-user-3")).toBeInTheDocument();
    expect(screen.queryByTestId("typing-bubble-user-2")).not.toBeInTheDocument();
  });

  it("cleans up heartbeat and typing timers on unmount to prevent leaks", () => {
    const { unmount } = render(<CollaborativeNotes folderId="folder-101" />);

    mockSocketSend.mockClear();
    unmount();

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    // No heartbeat should fire after unmount
    expect(mockSocketSend).not.toHaveBeenCalled();
  });
});
