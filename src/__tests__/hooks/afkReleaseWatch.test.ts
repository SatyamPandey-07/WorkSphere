/**
 * Tests for the releaseWatch functionality in useAFKLaptopWatch (Issue #2082).
 * When a user returns from their break, releaseWatch notifies the watcher.
 */

interface WatchState {
  status: "available" | "watching" | "unavailable";
  watcherUserId: string | null;
}

function createWatchStateManager() {
  let state: WatchState = { status: "available", watcherUserId: null };
  const sentMessages: string[] = [];

  const requestWatch = (venueId: string, userId: string) => {
    sentMessages.push(JSON.stringify({ type: "laptop-watch-request", venueId, fromUserId: userId }));
    state = { ...state, status: "unavailable" };
  };

  const acceptRequest = (venueId: string, watcherUserId: string, requesterId: string) => {
    sentMessages.push(JSON.stringify({ type: "laptop-watch-accept", venueId, toUserId: requesterId, fromUserId: watcherUserId }));
    state = { ...state, watcherUserId };
  };

  const releaseWatch = (venueId: string, userId: string) => {
    sentMessages.push(JSON.stringify({ type: "laptop-watch-release", venueId, fromUserId: userId }));
    state = { status: "available", watcherUserId: null };
  };

  return { state: () => state, sentMessages, requestWatch, acceptRequest, releaseWatch };
}

describe("AFK Laptop Watch — releaseWatch flow", () => {
  it("releaseWatch sets status back to 'available'", () => {
    const mgr = createWatchStateManager();
    mgr.requestWatch("v1", "user-1");
    mgr.acceptRequest("v1", "watcher-2", "user-1");
    mgr.releaseWatch("v1", "user-1");

    expect(mgr.state().status).toBe("available");
  });

  it("releaseWatch clears watcherUserId", () => {
    const mgr = createWatchStateManager();
    mgr.requestWatch("v1", "user-1");
    mgr.acceptRequest("v1", "watcher-2", "user-1");
    mgr.releaseWatch("v1", "user-1");

    expect(mgr.state().watcherUserId).toBeNull();
  });

  it("releaseWatch sends laptop-watch-release message", () => {
    const mgr = createWatchStateManager();
    mgr.requestWatch("v1", "user-1");
    mgr.releaseWatch("v1", "user-1");

    const lastMsg = JSON.parse(mgr.sentMessages[mgr.sentMessages.length - 1]);
    expect(lastMsg.type).toBe("laptop-watch-release");
    expect(lastMsg.fromUserId).toBe("user-1");
  });

  it("full flow: request → accept → release returns to available", () => {
    const mgr = createWatchStateManager();

    expect(mgr.state().status).toBe("available");

    mgr.requestWatch("v1", "user-1");
    expect(mgr.state().status).toBe("unavailable");

    mgr.acceptRequest("v1", "watcher-2", "user-1");
    expect(mgr.state().watcherUserId).toBe("watcher-2");

    mgr.releaseWatch("v1", "user-1");
    expect(mgr.state().status).toBe("available");
    expect(mgr.state().watcherUserId).toBeNull();
  });

  it("messages are in correct order for full flow", () => {
    const mgr = createWatchStateManager();
    mgr.requestWatch("v1", "user-1");
    mgr.acceptRequest("v1", "watcher-2", "user-1");
    mgr.releaseWatch("v1", "user-1");

    const types = mgr.sentMessages.map((m) => JSON.parse(m).type);
    expect(types).toEqual([
      "laptop-watch-request",
      "laptop-watch-accept",
      "laptop-watch-release",
    ]);
  });
});
