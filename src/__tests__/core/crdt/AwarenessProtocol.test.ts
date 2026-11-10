import {
  AwarenessProtocol,
  PeerPresenceState,
} from "@/core/crdt/AwarenessProtocol";
import * as Y from "yjs";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => any;
declare const beforeEach: (fn: () => void) => void;
declare const afterEach: (fn: () => void) => void;
declare const jest: any;

describe("AwarenessProtocol", () => {
  let doc1: Y.Doc;
  let doc2: Y.Doc;
  let protocol1: AwarenessProtocol;
  let protocol2: AwarenessProtocol;

  beforeEach(() => {
    jest.useFakeTimers();
    doc1 = new Y.Doc();
    doc2 = new Y.Doc();
    protocol1 = new AwarenessProtocol(doc1);
    protocol2 = new AwarenessProtocol(doc2);
  });

  afterEach(() => {
    protocol1.destroy();
    protocol2.destroy();
    doc1.destroy();
    doc2.destroy();
    jest.useRealTimers();
  });

  it("sets and retrieves local presence state", () => {
    protocol1.setLocalState({
      username: "Alice",
      avatar: "http://example.com/alice.png",
      deskId: "desk-42",
      status: "active",
    });

    const localState = protocol1.getLocalState();
    expect(localState).toMatchObject({
      username: "Alice",
      avatar: "http://example.com/alice.png",
      deskId: "desk-42",
      status: "active",
    });
  });

  it("updates cursor coordinates", () => {
    protocol1.setLocalState({ username: "Bob", avatar: null, status: "active" });
    protocol1.updateCursor({ x: 120, y: 250 });

    const localState = protocol1.getLocalState();
    expect(localState?.cursor).toEqual({ x: 120, y: 250 });
  });

  it("updates focus timer state and status", () => {
    protocol1.setLocalState({ username: "Charlie", avatar: null, status: "active" });
    protocol1.updateFocusTimer({
      isActive: true,
      durationMinutes: 25,
      remainingSeconds: 1500,
      sessionType: "pomodoro",
    });

    const localState = protocol1.getLocalState();
    expect(localState?.status).toBe("focusing");
    expect(localState?.focusTimer?.isActive).toBe(true);
  });

  it("synchronizes awareness updates between two peers", () => {
    protocol1.setLocalState({
      username: "Alice",
      avatar: null,
      deskId: "desk-1",
      status: "active",
    });

    // Encode update from client 1 and apply to client 2
    const update = protocol1.encodeUpdate();
    protocol2.applyUpdate(update);

    const client1ID = protocol1.getClientID();
    const activePeers = protocol2.getActivePeers();

    expect(activePeers.has(client1ID)).toBe(true);
    expect(activePeers.get(client1ID)?.username).toBe("Alice");
    expect(activePeers.get(client1ID)?.deskId).toBe("desk-1");
  });

  it("prunes inactive peers whose heartbeat exceeds 15 seconds", () => {
    protocol1.setLocalState({
      username: "Alice",
      avatar: null,
      status: "active",
    });

    const update = protocol1.encodeUpdate();
    protocol2.applyUpdate(update);

    expect(protocol2.getActivePeers().size).toBe(2);

    // Advance time past 15 seconds
    jest.advanceTimersByTime(16_000);

    // Active peers should prune the stale peer
    const remainingPeers = protocol2.getActivePeers();
    expect(remainingPeers.has(protocol1.getClientID())).toBe(false);
  });
});

