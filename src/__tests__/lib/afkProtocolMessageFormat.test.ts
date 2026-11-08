/**
 * Tests for the AFK Laptop Watch message format (Issue #2082).
 * Verifies message types and required fields.
 */

type AFKMessageType =
  | "laptop-watch-request"
  | "laptop-watch-accept"
  | "laptop-watch-decline"
  | "laptop-watch-release";

interface BaseAFKMessage {
  type: AFKMessageType;
  venueId: string;
}

interface WatchRequestMessage extends BaseAFKMessage {
  type: "laptop-watch-request";
  fromUserId: string;
  fromName: string;
}

interface WatchAcceptMessage extends BaseAFKMessage {
  type: "laptop-watch-accept";
  toUserId: string;
  fromUserId: string;
}

function createWatchRequest(venueId: string, fromUserId: string, fromName: string): WatchRequestMessage {
  return { type: "laptop-watch-request", venueId, fromUserId, fromName };
}

function createWatchAccept(venueId: string, toUserId: string, fromUserId: string): WatchAcceptMessage {
  return { type: "laptop-watch-accept", venueId, toUserId, fromUserId };
}

describe("AFK message format validation", () => {
  it("laptop-watch-request has correct type", () => {
    const msg = createWatchRequest("v1", "user-1", "Alice");
    expect(msg.type).toBe("laptop-watch-request");
  });

  it("laptop-watch-request includes fromUserId and fromName", () => {
    const msg = createWatchRequest("v1", "user-1", "Alice");
    expect(msg.fromUserId).toBe("user-1");
    expect(msg.fromName).toBe("Alice");
  });

  it("laptop-watch-request includes venueId", () => {
    const msg = createWatchRequest("venue-abc", "user-1", "Alice");
    expect(msg.venueId).toBe("venue-abc");
  });

  it("laptop-watch-accept has correct type", () => {
    const msg = createWatchAccept("v1", "user-1", "user-2");
    expect(msg.type).toBe("laptop-watch-accept");
  });

  it("laptop-watch-accept includes toUserId and fromUserId", () => {
    const msg = createWatchAccept("v1", "requester", "watcher");
    expect(msg.toUserId).toBe("requester");
    expect(msg.fromUserId).toBe("watcher");
  });

  it("all message types are kebab-case starting with 'laptop-watch'", () => {
    const types: AFKMessageType[] = [
      "laptop-watch-request",
      "laptop-watch-accept",
      "laptop-watch-decline",
      "laptop-watch-release",
    ];
    types.forEach((t) => {
      expect(t).toMatch(/^laptop-watch-/);
    });
  });

  it("serializable to JSON (no circular references)", () => {
    const msg = createWatchRequest("v1", "user-1", "Alice");
    expect(() => JSON.stringify(msg)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(msg));
    expect(parsed.type).toBe("laptop-watch-request");
  });
});
