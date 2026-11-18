/** @jest-environment jsdom */
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { GroupNotesEditor } from "@/components/notes/GroupNotesEditor";
import * as notesOutbox from "@/lib/crdt/notesOutbox";

type EventCallback = (...args: any[]) => void;

class MockPartyKitProvider {
  static instances: MockPartyKitProvider[] = [];
  static shouldThrowOnConstruct = false;

  listeners: Record<string, EventCallback[]> = {};
  awarenessListeners: Record<string, EventCallback[]> = {};
  wsconnected = false;
  wsconnecting = true;
  shouldConnect = true;
  synced = false;
  ws = { readyState: 1 }; // 1 = OPEN

  awareness = {
    clientID: 100,
    states: new Map<number, any>(),
    getStates: jest.fn(() => this.awareness.states),
    setLocalStateField: jest.fn(),
    on: jest.fn((event: string, cb: EventCallback) => {
      this.awarenessListeners[event] = this.awarenessListeners[event] || [];
      this.awarenessListeners[event].push(cb);
    }),
    off: jest.fn((event: string, cb: EventCallback) => {
      this.awarenessListeners[event] = (
        this.awarenessListeners[event] || []
      ).filter((l) => l !== cb);
    }),
  };

  constructor(
    public host: string,
    public room: string,
    public doc: any,
    public options?: { params?: () => Promise<Record<string, string>> },
  ) {
    if (MockPartyKitProvider.shouldThrowOnConstruct) {
      throw new Error("PartyKit initialization error");
    }
    MockPartyKitProvider.instances.push(this);
  }

  on(event: string, cb: EventCallback) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(cb);
  }

  off(event: string, cb: EventCallback) {
    this.listeners[event] = (this.listeners[event] || []).filter(
      (l) => l !== cb,
    );
  }

  destroy = jest.fn();
  disconnect = jest.fn();

  emit(event: string, ...args: any[]) {
    (this.listeners[event] || []).forEach((cb) => cb(...args));
  }

  emitAwarenessChange(newStates?: Map<number, any>) {
    if (newStates) {
      this.awareness.states = newStates;
    }
    (this.awarenessListeners["change"] || []).forEach((cb) => cb());
  }
}

jest.mock("y-partykit/provider", () => {
  return jest.fn().mockImplementation((...args: any[]) => {
    return new (MockPartyKitProvider as any)(...args);
  });
});

let idbThrowOnConstruct = false;
class MockIndexeddbPersistence {
  static instances: MockIndexeddbPersistence[] = [];
  listeners: Record<string, EventCallback[]> = {};

  constructor(
    public name: string,
    public doc: any,
  ) {
    if (idbThrowOnConstruct) {
      throw new Error("IndexedDB security exception");
    }
    MockIndexeddbPersistence.instances.push(this);
  }

  on(event: string, cb: EventCallback) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(cb);
  }

  destroy = jest.fn().mockResolvedValue(undefined);

  emit(event: string, ...args: any[]) {
    (this.listeners[event] || []).forEach((cb) => cb(...args));
  }
}

jest.mock("y-indexeddb", () => ({
  IndexeddbPersistence: jest.fn().mockImplementation((...args: any[]) => {
    return new (MockIndexeddbPersistence as any)(...args);
  }),
}));

const mockOutboxStore = new Map<string, any[]>();

jest.mock("@/lib/crdt/notesOutbox", () => ({
  listNotesOutbox: jest.fn(
    async (roomId: string) => mockOutboxStore.get(roomId) || [],
  ),
  enqueueNotesUpdate: jest.fn(async (roomId: string, update: Uint8Array) => {
    const list = mockOutboxStore.get(roomId) || [];
    list.push({ roomId, update: Array.from(update), createdAt: Date.now() });
    mockOutboxStore.set(roomId, list);
    return true;
  }),
  flushNotesOutbox: jest.fn(async (roomId: string) => {
    const list = mockOutboxStore.get(roomId) || [];
    const count = list.length;
    mockOutboxStore.set(roomId, []);
    return { flushed: count, conflicts: [] };
  }),
  loadNotesDocState: jest.fn().mockResolvedValue(null),
  saveNotesDocState: jest.fn().mockResolvedValue(undefined),
  resolveConflictsKeepLocal: jest.fn().mockResolvedValue(undefined),
  resolveConflictsUseRemote: jest.fn().mockResolvedValue(undefined),
  getPendingNotesUpdateCount: jest.fn(
    async (roomId: string) => (mockOutboxStore.get(roomId) || []).length,
  ),
}));

async function renderEditor(props: any) {
  let res: any;
  await act(async () => {
    res = render(<GroupNotesEditor {...props} />);
  });
  return res;
}

describe("GroupNotesEditor", () => {
  beforeEach(() => {
    MockPartyKitProvider.instances = [];
    MockPartyKitProvider.shouldThrowOnConstruct = false;
    MockIndexeddbPersistence.instances = [];
    idbThrowOnConstruct = false;
    mockOutboxStore.clear();
    jest.clearAllMocks();
  });

  it("sends the user's Clerk token so PartyKit does not make the connection read-only", async () => {
    const getToken = jest.fn().mockResolvedValue("clerk-session-token");
    const useAuthSpy = jest
      .spyOn(jest.requireMock("@clerk/nextjs"), "useAuth")
      .mockReturnValue({ userId: "test-user", isSignedIn: true, getToken });

    await renderEditor({ roomId: "venue-42" });

    const provider = MockPartyKitProvider.instances[0];
    expect(provider.room).toBe("notes-venue-42");
    await expect(provider.options?.params?.()).resolves.toEqual({
      token: "clerk-session-token",
    });

    // A new token is fetched on each (re)connect.
    getToken.mockResolvedValueOnce("refreshed-token");
    await expect(provider.options?.params?.()).resolves.toEqual({
      token: "refreshed-token",
    });

    useAuthSpy.mockRestore();
  });

  it("connects with an empty token when no token is available", async () => {
    await renderEditor({ roomId: "venue-anon" });

    const provider = MockPartyKitProvider.instances[0];
    await expect(provider.options?.params?.()).resolves.toEqual({ token: "" });
  });

  it("renders the rich-text group notes chrome", async () => {
    await renderEditor({ roomId: "cowork-1" });
    expect(screen.getByText(/Group Notes/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Coworking group notes editor/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
    expect(screen.getByLabelText("Italic")).toBeInTheDocument();
    expect(screen.getByLabelText("Underline")).toBeInTheDocument();
    expect(screen.getByLabelText("Export Markdown (.md)")).toBeInTheDocument();
    expect(screen.getByLabelText("Clear notes")).toBeInTheDocument();
  });

  describe("Connection Status Monitoring & Pill", () => {
    it("initializes with Reconnecting... pill state when connecting", async () => {
      await renderEditor({ roomId: "room-conn-1" });
      const pill = screen.getByTestId("connection-status-pill");
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveAttribute("data-status", "connecting");
      expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
    });

    it("transitions to Connected state when provider emits status 'connected'", async () => {
      await renderEditor({ roomId: "room-conn-2" });
      const provider = MockPartyKitProvider.instances[0];
      expect(provider).toBeDefined();

      await act(async () => {
        provider.wsconnected = true;
        provider.emit("status", { status: "connected" });
      });

      const pill = screen.getByTestId("connection-status-pill");
      expect(pill).toHaveAttribute("data-status", "connected");
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    it("transitions to Offline state when provider emits status 'disconnected'", async () => {
      await renderEditor({ roomId: "room-conn-3" });
      const provider = MockPartyKitProvider.instances[0];

      // Connect first
      await act(async () => {
        provider.wsconnected = true;
        provider.emit("status", { status: "connected" });
      });
      expect(screen.getByText("Connected")).toBeInTheDocument();

      // Now disconnect
      await act(async () => {
        provider.wsconnected = false;
        provider.emit("status", { status: "disconnected" });
      });

      const pill = screen.getByTestId("connection-status-pill");
      expect(pill).toHaveAttribute("data-status", "disconnected");
      expect(screen.getByText("Offline")).toBeInTheDocument();
    });

    it("transitions from disconnected to connecting during automatic reconnect attempt", async () => {
      await renderEditor({ roomId: "room-conn-4" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.wsconnected = false;
        provider.emit("status", { status: "disconnected" });
      });
      expect(screen.getByText("Offline")).toBeInTheDocument();

      // PartyKit provider attempts reconnect
      await act(async () => {
        provider.wsconnecting = true;
        provider.emit("status", { status: "connecting" });
      });
      expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
    });

    it("successfully reconnects back to Connected", async () => {
      await renderEditor({ roomId: "room-conn-5" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.wsconnected = false;
        provider.emit("status", { status: "disconnected" });
      });
      await act(async () => {
        provider.emit("status", { status: "connecting" });
      });
      await act(async () => {
        provider.wsconnected = true;
        provider.emit("status", { status: "connected" });
      });

      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    it("handles repeated status events safely without crashing or thrashing", async () => {
      await renderEditor({ roomId: "room-conn-6" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.emit("status", { status: "connecting" });
        provider.emit("status", { status: "connecting" });
        provider.emit("status", { status: "connected" });
        provider.emit("status", { status: "connected" });
      });

      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    it("cleans up listeners and destroys provider on unmount", async () => {
      const { unmount } = await renderEditor({ roomId: "room-conn-7" });
      const provider = MockPartyKitProvider.instances[0];
      expect(provider).toBeDefined();

      unmount();
      expect(provider.destroy).toHaveBeenCalled();
    });

    it("replaces provider and cleans up previous listeners when roomId changes", async () => {
      const { rerender } = await renderEditor({ roomId: "room-A" });
      const providerA = MockPartyKitProvider.instances[0];

      await act(async () => {
        rerender(<GroupNotesEditor roomId="room-B" />);
      });
      expect(providerA.destroy).toHaveBeenCalled();

      const providerB = MockPartyKitProvider.instances[1];
      expect(providerB).toBeDefined();
      expect(providerB.room).toBe("notes-room-B");
    });
  });

  describe("Offline Banner & Accurate Pending Sync Counter", () => {
    it("displays offline warning banner when disconnected and IndexedDB fallback is active", async () => {
      await renderEditor({ roomId: "room-off-1" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.wsconnected = false;
        provider.emit("status", { status: "disconnected" });
      });

      const banner = screen.getByTestId("offline-sync-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveAttribute("data-persistence-ready", "true");
      expect(
        screen.getByText(
          /You're offline\. Your changes are saved locally and will sync when you're reconnected\./i,
        ),
      ).toBeInTheDocument();
    });

    it("disappears after reconnection and outbox synchronization", async () => {
      await renderEditor({ roomId: "room-off-2" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.wsconnected = false;
        provider.emit("status", { status: "disconnected" });
      });
      expect(screen.getByTestId("offline-sync-banner")).toBeInTheDocument();

      await act(async () => {
        provider.wsconnected = true;
        provider.emit("status", { status: "connected" });
        provider.emit("sync", true);
      });

      await waitFor(() => {
        expect(screen.queryByTestId("offline-sync-banner")).toBeNull();
      });
    });

    it("loads and displays existing pending changes count from IndexedDB on mount", async () => {
      mockOutboxStore.set("room-off-3", [
        { roomId: "room-off-3", update: [1, 2], createdAt: 100 },
        { roomId: "room-off-3", update: [3, 4], createdAt: 200 },
        { roomId: "room-off-3", update: [5, 6], createdAt: 300 },
      ]);

      await renderEditor({ roomId: "room-off-3" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.wsconnected = false;
        provider.emit("status", { status: "disconnected" });
      });

      await waitFor(() => {
        expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
          "3 pending changes",
        );
      });
    });

    it("decreases pending count only after confirmed synchronization", async () => {
      mockOutboxStore.set("room-off-4", [
        { roomId: "room-off-4", update: [1], createdAt: 100 },
        { roomId: "room-off-4", update: [2], createdAt: 200 },
      ]);

      let resolveFlush: (value: any) => void;
      (notesOutbox.flushNotesOutbox as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveFlush = res;
          }),
      );

      await renderEditor({ roomId: "room-off-4" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.wsconnected = false;
        provider.emit("status", { status: "disconnected" });
      });

      await waitFor(() => {
        expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
          "2 pending changes",
        );
      });

      // Provider connects, but flush has not resolved yet
      await act(async () => {
        provider.wsconnected = true;
        provider.emit("status", { status: "connected" });
      });

      // Pending count must not be cleared prematurely before flush resolves
      expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
        "2 pending changes",
      );

      // Now resolve the flush
      await act(async () => {
        mockOutboxStore.set("room-off-4", []);
        resolveFlush!({ flushed: 2, conflicts: [] });
      });

      await waitFor(() => {
        expect(screen.queryByTestId("offline-sync-banner")).toBeNull();
      });
    });

    it("displays empty pending state (0 changes) accurately", async () => {
      await renderEditor({ roomId: "room-off-5" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.wsconnected = false;
        provider.emit("status", { status: "disconnected" });
      });

      expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
        "0 pending changes",
      );
    });

    it("handles persistence initialization failure honestly", async () => {
      idbThrowOnConstruct = true;
      await renderEditor({ roomId: "room-off-6" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.wsconnected = false;
        provider.emit("status", { status: "disconnected" });
      });

      const banner = screen.getByTestId("offline-sync-banner");
      expect(banner).toHaveAttribute("data-persistence-ready", "false");
      expect(
        screen.getByText(
          /You're offline\. Local persistence is unavailable — changes may not be saved locally\./i,
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("pending-sync-counter")).toHaveTextContent(
        "Persistence Unavailable",
      );
    });
  });

  describe("Collaborator Awareness", () => {
    it("renders connected collaborators from awareness state", async () => {
      await renderEditor({
        roomId: "room-aware-1",
        currentUser: { name: "Local User" },
      });
      const provider = MockPartyKitProvider.instances[0];

      const states = new Map<number, any>([
        [
          100, // Local client ID (must be excluded)
          { user: { name: "Local User", cursorIndex: 0 } },
        ],
        [
          201,
          {
            user: {
              name: "Maya Lin",
              avatarUrl: "https://example.com/maya.jpg",
              color: "#16a34a",
              cursorIndex: 25,
            },
          },
        ],
      ]);

      await act(async () => {
        provider.emitAwarenessChange(states);
      });

      expect(screen.getByTestId("awareness-cursors-bar")).toBeInTheDocument();
      expect(screen.getByText("Maya Lin")).toBeInTheDocument();
      expect(screen.getByText("@25")).toBeInTheDocument();
      expect(screen.queryByText("Local User")).toBeNull();
    });

    it("updates UI dynamically when peer joins or changes presence", async () => {
      await renderEditor({ roomId: "room-aware-2" });
      const provider = MockPartyKitProvider.instances[0];

      const state1 = new Map<number, any>([
        [202, { user: { name: "David", cursorIndex: 5 } }],
      ]);
      await act(async () => {
        provider.emitAwarenessChange(state1);
      });
      expect(screen.getByText("David")).toBeInTheDocument();

      // Peer updates cursor position
      const state2 = new Map<number, any>([
        [202, { user: { name: "David", cursorIndex: 30 } }],
      ]);
      await act(async () => {
        provider.emitAwarenessChange(state2);
      });
      expect(screen.getByText("@30")).toBeInTheDocument();

      // Peer disconnects
      await act(async () => {
        provider.emitAwarenessChange(new Map());
      });
      expect(screen.queryByText("David")).toBeNull();
    });

    it("handles missing collaborator names and avatars gracefully", async () => {
      await renderEditor({ roomId: "room-aware-3" });
      const provider = MockPartyKitProvider.instances[0];

      const states = new Map<number, any>([
        [303, { user: { name: "", color: "#2563eb" } }],
      ]);
      await act(async () => {
        provider.emitAwarenessChange(states);
      });

      expect(screen.getByText("Collaborator 303")).toBeInTheDocument();
      expect(screen.getByText("C")).toBeInTheDocument();
    });

    it("cleans up awareness listeners on unmount", async () => {
      const { unmount } = await renderEditor({ roomId: "room-aware-4" });
      const provider = MockPartyKitProvider.instances[0];

      unmount();
      expect(provider.awareness.off).toHaveBeenCalledWith(
        "change",
        expect.any(Function),
      );
    });
  });

  describe("Edge Cases", () => {
    it("handles provider initialization failure gracefully without crashing", async () => {
      MockPartyKitProvider.shouldThrowOnConstruct = true;
      await act(async () => {
        render(<GroupNotesEditor roomId="room-edge-fail" />);
      });

      const pill = screen.getByTestId("connection-status-pill");
      expect(pill).toHaveAttribute("data-status", "disconnected");
      expect(screen.getByText("Offline")).toBeInTheDocument();
    });

    it("survives rapid connection state cycling", async () => {
      await renderEditor({ roomId: "room-edge-rapid" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.emit("status", { status: "connecting" });
        provider.emit("status", { status: "connected" });
        provider.emit("status", { status: "disconnected" });
        provider.emit("status", { status: "connecting" });
        provider.emit("status", { status: "connected" });
      });

      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    it("does not trigger React state updates after unmount during async flush", async () => {
      let resolveFlush: (value: any) => void;
      (notesOutbox.flushNotesOutbox as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveFlush = res;
          }),
      );

      const { unmount } = await renderEditor({ roomId: "room-edge-unmount" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.emit("status", { status: "connected" });
      });

      // Unmount before flush completes
      unmount();

      // Now resolve
      await act(async () => {
        resolveFlush!({ flushed: 1, conflicts: [] });
      });
    });

    it("handles duplicate sync events safely", async () => {
      await renderEditor({ roomId: "room-edge-dup-sync" });
      const provider = MockPartyKitProvider.instances[0];

      await act(async () => {
        provider.emit("status", { status: "connected" });
        provider.emit("sync", true);
        provider.emit("sync", true);
      });

      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
  });
});
