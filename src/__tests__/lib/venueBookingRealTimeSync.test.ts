/**
 * Tests for real-time booking state synchronization across clients.
 */

type SyncOperation = "create" | "update" | "delete" | "patch";

interface SyncMessage {
  messageId: string;
  bookingId: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  timestamp: number;
  clientId: string;
  sequenceNumber: number;
}

interface ClientSyncState {
  clientId: string;
  lastSequenceNumber: number;
  pendingMessages: SyncMessage[];
  lastSyncedAt: number;
}

function isMessageInOrder(msg: SyncMessage, state: ClientSyncState): boolean {
  return msg.sequenceNumber === state.lastSequenceNumber + 1;
}

function hasPendingConflict(msg: SyncMessage, pending: SyncMessage[]): boolean {
  return pending.some(
    (p) => p.bookingId === msg.bookingId && p.timestamp !== msg.timestamp
  );
}

function applyMessage(state: ClientSyncState, msg: SyncMessage, nowMs: number): ClientSyncState {
  if (!isMessageInOrder(msg, state)) {
    return {
      ...state,
      pendingMessages: [...state.pendingMessages, msg].sort((a, b) => a.sequenceNumber - b.sequenceNumber),
    };
  }

  return {
    ...state,
    lastSequenceNumber: msg.sequenceNumber,
    lastSyncedAt: nowMs,
    pendingMessages: state.pendingMessages.filter((p) => p.sequenceNumber > msg.sequenceNumber),
  };
}

function isSyncStale(state: ClientSyncState, nowMs: number, staleMs = 30_000): boolean {
  return nowMs - state.lastSyncedAt > staleMs;
}

function messageBacklog(state: ClientSyncState): number {
  return state.pendingMessages.length;
}

const NOW = 1_700_000_000_000;
const CLIENT_STATE: ClientSyncState = {
  clientId: "client1", lastSequenceNumber: 5,
  pendingMessages: [], lastSyncedAt: NOW - 1000,
};

const NEXT_MSG: SyncMessage = {
  messageId: "m1", bookingId: "b1", operation: "update",
  payload: { status: "confirmed" }, timestamp: NOW,
  clientId: "server", sequenceNumber: 6,
};

describe("Real-time booking sync", () => {
  it("isMessageInOrder: seq 6 follows seq 5 → true", () => {
    expect(isMessageInOrder(NEXT_MSG, CLIENT_STATE)).toBe(true);
  });

  it("isMessageInOrder: out-of-order → false", () => {
    const ooo = { ...NEXT_MSG, sequenceNumber: 8 };
    expect(isMessageInOrder(ooo, CLIENT_STATE)).toBe(false);
  });

  it("applyMessage: in-order → increments lastSequenceNumber", () => {
    const updated = applyMessage(CLIENT_STATE, NEXT_MSG, NOW);
    expect(updated.lastSequenceNumber).toBe(6);
    expect(updated.lastSyncedAt).toBe(NOW);
  });

  it("applyMessage: out-of-order → added to pending", () => {
    const ooo = { ...NEXT_MSG, sequenceNumber: 8 };
    const updated = applyMessage(CLIENT_STATE, ooo, NOW);
    expect(updated.pendingMessages).toHaveLength(1);
    expect(updated.lastSequenceNumber).toBe(5); // unchanged
  });

  it("isSyncStale: 1s since sync → not stale", () => {
    expect(isSyncStale(CLIENT_STATE, NOW)).toBe(false);
  });

  it("isSyncStale: 31s since sync → stale", () => {
    expect(isSyncStale(CLIENT_STATE, NOW + 31_000)).toBe(true);
  });

  it("messageBacklog: 0 pending messages", () => {
    expect(messageBacklog(CLIENT_STATE)).toBe(0);
  });
});
