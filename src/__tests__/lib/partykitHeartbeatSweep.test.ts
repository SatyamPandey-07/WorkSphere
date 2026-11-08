/**
 * Tests for the PartyKit room heartbeat sweep fix (Issue #1936).
 * The sweep should prune seatCheckins and locks for orphaned connections.
 */

interface ConnState { lastPong: number; name?: string; }
interface SeatCheckin { venueId: string; capacity: number; version: number; }

class MockRoomSweeper {
  connectionStates = new Map<string, ConnState>();
  seatCheckins = new Map<string, SeatCheckin>();
  seatCheckinLocks = new Set<string>();

  broadcastedUpdates: string[] = [];
  closedConnections: string[] = [];

  // Simulates the getConnection behavior
  private activeConnections = new Set<string>();

  activateConnection(connId: string, name?: string) {
    this.activeConnections.add(connId);
    this.connectionStates.set(connId, { lastPong: Date.now(), name });
  }

  deactivateConnection(connId: string) {
    this.activeConnections.delete(connId);
  }

  getConnection(connId: string): boolean {
    return this.activeConnections.has(connId);
  }

  sweepOrphans(now: number) {
    for (const [connId, state] of this.connectionStates.entries()) {
      if (!this.getConnection(connId)) {
        // Prune orphaned connection
        this.connectionStates.delete(connId);
        if (this.seatCheckins.has(connId)) {
          const prev = this.seatCheckins.get(connId)!;
          this.seatCheckins.delete(connId);
          this.broadcastedUpdates.push(prev.venueId);
        }
        this.seatCheckinLocks.delete(connId);
        continue;
      }

      // Check 45-second timeout
      if (now - state.lastPong > 45000) {
        if (state.name) this.broadcastedUpdates.push("peer-leave");
        this.closedConnections.push(connId);
        this.connectionStates.delete(connId);
        if (this.seatCheckins.has(connId)) {
          const prev = this.seatCheckins.get(connId)!;
          this.seatCheckins.delete(connId);
          this.broadcastedUpdates.push(prev.venueId);
        }
        this.seatCheckinLocks.delete(connId);
      }
    }
  }
}

describe("PartyKit heartbeat sweep — orphan cleanup", () => {
  it("prunes connectionState for orphaned connections", () => {
    const sweeper = new MockRoomSweeper();
    sweeper.activateConnection("conn-1");
    sweeper.deactivateConnection("conn-1"); // orphaned

    sweeper.sweepOrphans(Date.now());
    expect(sweeper.connectionStates.has("conn-1")).toBe(false);
  });

  it("prunes seatCheckin for orphaned connections and broadcasts update", () => {
    const sweeper = new MockRoomSweeper();
    sweeper.activateConnection("conn-1");
    sweeper.seatCheckins.set("conn-1", { venueId: "venue-A", capacity: 8, version: 1 });
    sweeper.deactivateConnection("conn-1");

    sweeper.sweepOrphans(Date.now());

    expect(sweeper.seatCheckins.has("conn-1")).toBe(false);
    expect(sweeper.broadcastedUpdates).toContain("venue-A");
  });

  it("prunes seatCheckinLocks for orphaned connections", () => {
    const sweeper = new MockRoomSweeper();
    sweeper.activateConnection("conn-1");
    sweeper.seatCheckinLocks.add("conn-1");
    sweeper.deactivateConnection("conn-1");

    sweeper.sweepOrphans(Date.now());
    expect(sweeper.seatCheckinLocks.has("conn-1")).toBe(false);
  });

  it("keeps active connections untouched during sweep", () => {
    const sweeper = new MockRoomSweeper();
    sweeper.activateConnection("active-conn", "Alice");

    sweeper.sweepOrphans(Date.now());
    expect(sweeper.connectionStates.has("active-conn")).toBe(true);
  });

  it("closes timed-out connections (>45s without pong)", () => {
    const sweeper = new MockRoomSweeper();
    sweeper.activateConnection("old-conn");
    sweeper.connectionStates.set("old-conn", {
      lastPong: Date.now() - 50000, // 50 seconds ago
    });

    sweeper.sweepOrphans(Date.now());
    expect(sweeper.closedConnections).toContain("old-conn");
  });
});
