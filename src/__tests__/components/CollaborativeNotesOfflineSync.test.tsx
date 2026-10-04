/**
 * Unit tests for Offline Optimistic Updates, Sync Status Indicator, and LWW Conflict Resolution (#3786).
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as Y from "yjs";
import { CollaborativeNotes } from "@/components/collections/CollaborativeNotes";
import {
  resolveLwwEdits,
  type PendingNoteEdit,
} from "@/lib/offlineNotesSync";

type Handler = (arg: unknown) => void;

class FakeYPartyKitProvider {
  static last: FakeYPartyKitProvider;
  handlers: Record<string, Handler[]> = {};
  ws: { readyState: number } = { readyState: 1 };

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

jest.mock("partysocket/react", () => {
  return jest.fn((options) => {
    sharedSocketInstance.options = options;
    return sharedSocketInstance;
  });
});

const mockPendingQueue: PendingNoteEdit[] = [];
let mockCachedNote: { folderId: string; text: string; updatedAt: number } | null = null;

jest.mock("@/lib/offlineNotesSync", () => {
  const actual = jest.requireActual("@/lib/offlineNotesSync");
  return {
    ...actual,
    enqueuePendingNoteEdit: jest.fn(async (folderId: string, text: string, timestamp?: number) => {
      mockPendingQueue.push({
        id: mockPendingQueue.length + 1,
        folderId,
        text,
        timestamp: timestamp || Date.now(),
      });
      mockCachedNote = { folderId, text, updatedAt: timestamp || Date.now() };
      return mockPendingQueue.length;
    }),
    loadCachedNote: jest.fn(async () => mockCachedNote),
    cacheNoteLocally: jest.fn(async (folderId: string, text: string, updatedAt?: number) => {
      mockCachedNote = { folderId, text, updatedAt: updatedAt || Date.now() };
    }),
    getPendingEditsForFolder: jest.fn(async (folderId: string) => {
      return mockPendingQueue.filter((item) => item.folderId === folderId);
    }),
    clearPendingEditsForFolder: jest.fn(async (folderId: string) => {
      const remaining = mockPendingQueue.filter((item) => item.folderId !== folderId);
      mockPendingQueue.length = 0;
      mockPendingQueue.push(...remaining);
    }),
  };
});

const fetchMock = jest.fn().mockResolvedValue({ ok: true });

describe("CollaborativeNotes Offline Optimistic Updates & Sync Indicator (#3786)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockClear();
    mockSocketSend.mockClear();
    mockPendingQueue.length = 0;
    mockCachedNote = null;
    global.fetch = fetchMock as unknown as typeof fetch;
    global.requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0) as unknown as number;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("LWW (Last-Write-Wins) Conflict Resolution helper", () => {
    it("returns null for empty edits array", () => {
      expect(resolveLwwEdits([])).toBeNull();
    });

    it("selects the edit with the highest timestamp as winner", () => {
      const edits: PendingNoteEdit[] = [
        { id: 1, folderId: "f1", text: "First edit", timestamp: 1000 },
        { id: 2, folderId: "f1", text: "Conflicting edit", timestamp: 3000 },
        { id: 3, folderId: "f1", text: "Intermediate edit", timestamp: 2000 },
      ];

      const winner = resolveLwwEdits(edits);
      expect(winner).not.toBeNull();
      expect(winner?.id).toBe(2);
      expect(winner?.text).toBe("Conflicting edit");
    });
  });

  describe("Sync Status Indicator in Real Time", () => {
    it("shows 'Connecting…' initially", () => {
      render(<CollaborativeNotes folderId="folder-3786" />);
      const status = screen.getByTestId("notes-sync-status");
      expect(status).toHaveTextContent(/Connecting…/i);
    });

    it("transitions to 'Live — edits merge automatically' when provider syncs", () => {
      render(<CollaborativeNotes folderId="folder-3786" />);
      act(() => {
        FakeYPartyKitProvider.last.emit("sync", true);
      });

      const status = screen.getByTestId("notes-sync-status");
      expect(status).toHaveTextContent(/Live — edits merge automatically/i);
    });

    it("transitions to 'Offline — pending sync' when disconnected", () => {
      render(<CollaborativeNotes folderId="folder-3786" />);
      act(() => {
        FakeYPartyKitProvider.last.emit("sync", true);
      });

      act(() => {
        FakeYPartyKitProvider.last.emit("status", { status: "disconnected" });
      });

      const status = screen.getByTestId("notes-sync-status");
      expect(status).toHaveTextContent(/Offline — pending sync/i);
    });
  });

  describe("Offline Editing and Reconnection Replay", () => {
    it("allows seamless editing while offline and queues edits into IndexedDB", async () => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: false,
      });

      render(<CollaborativeNotes folderId="folder-3786" canEdit={true} />);

      act(() => {
        FakeYPartyKitProvider.last.emit("status", { status: "disconnected" });
      });

      const textarea = screen.getByRole("textbox", { name: "Collection notes" });

      // User types while offline
      fireEvent.change(textarea, { target: { value: "Offline note addition" } });

      expect(textarea).toHaveValue("Offline note addition");

      // Advance debounce timer (1500ms)
      act(() => {
        jest.advanceTimersByTime(1600);
      });

      const { enqueuePendingNoteEdit } = require("@/lib/offlineNotesSync");
      expect(enqueuePendingNoteEdit).toHaveBeenCalledWith(
        "folder-3786",
        "Offline note addition",
      );

      const status = screen.getByTestId("notes-sync-status");
      expect(status).toHaveTextContent(/Offline — pending sync/i);
    });

    it("replays queued edits to Postgres/PartyKit when connectivity is restored", async () => {
      const {
        clearPendingEditsForFolder,
        getPendingEditsForFolder,
      } = require("@/lib/offlineNotesSync");

      // Pre-populate queue with offline edit
      mockPendingQueue.push({
        id: 1,
        folderId: "folder-3786",
        text: "Offline queued text that should sync",
        timestamp: Date.now(),
      });

      render(<CollaborativeNotes folderId="folder-3786" canEdit={true} />);

      // Reconnection occurs
      await act(async () => {
        FakeYPartyKitProvider.last.emit("status", { status: "connected" });
      });

      expect(getPendingEditsForFolder).toHaveBeenCalledWith("folder-3786");
      expect(clearPendingEditsForFolder).toHaveBeenCalledWith("folder-3786");

      // Verifies snapshot PUT was called with merged LWW content
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/folders/folder-3786",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ description: "Offline queued text that should sync" }),
        }),
      );
    });
  });
});
