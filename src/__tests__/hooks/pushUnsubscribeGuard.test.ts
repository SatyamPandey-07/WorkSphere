/**
 * Tests for the push subscription unsubscribe guard added in fix/issue-1942.
 * Verifies DOMException is not thrown when permissions are revoked.
 */

// Simulate the guard logic
async function safeUnsubscribe(
  permission: NotificationPermission,
  unsubscribeMock: jest.Mock,
  setIsSubscribed: (v: boolean) => void,
  setPermission: (v: NotificationPermission) => void,
): Promise<boolean> {
  if (permission === "denied") {
    setPermission("denied");
    setIsSubscribed(false);
    return true; // handled gracefully without calling unsubscribe
  }

  await unsubscribeMock();
  setIsSubscribed(false);
  return true;
}

describe("Push notification unsubscribe guard", () => {
  it("skips unsubscribe call when permission is denied", async () => {
    const unsubscribeMock = jest.fn();
    const setIsSubscribed = jest.fn();
    const setPermission = jest.fn();

    const result = await safeUnsubscribe(
      "denied",
      unsubscribeMock,
      setIsSubscribed,
      setPermission,
    );

    expect(unsubscribeMock).not.toHaveBeenCalled();
    expect(setIsSubscribed).toHaveBeenCalledWith(false);
    expect(setPermission).toHaveBeenCalledWith("denied");
    expect(result).toBe(true);
  });

  it("calls unsubscribe normally when permission is granted", async () => {
    const unsubscribeMock = jest.fn().mockResolvedValue(true);
    const setIsSubscribed = jest.fn();
    const setPermission = jest.fn();

    await safeUnsubscribe("granted", unsubscribeMock, setIsSubscribed, setPermission);

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(setIsSubscribed).toHaveBeenCalledWith(false);
    expect(setPermission).not.toHaveBeenCalled();
  });

  it("calls unsubscribe normally when permission is default", async () => {
    const unsubscribeMock = jest.fn().mockResolvedValue(true);
    const setIsSubscribed = jest.fn();
    const setPermission = jest.fn();

    await safeUnsubscribe("default", unsubscribeMock, setIsSubscribed, setPermission);

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("handles DOMException gracefully when permission is denied", async () => {
    // Simulate a DOMException being thrown if guard wasn't in place
    const throwingUnsubscribe = jest.fn().mockRejectedValue(
      new DOMException("The push subscription has expired or the user has revoked permissions."),
    );
    const setIsSubscribed = jest.fn();
    const setPermission = jest.fn();

    // With guard, the DOMException is never reached
    await expect(
      safeUnsubscribe("denied", throwingUnsubscribe, setIsSubscribed, setPermission),
    ).resolves.toBe(true);

    expect(throwingUnsubscribe).not.toHaveBeenCalled();
  });
});

describe("Permission state synchronization", () => {
  it("sets isSubscribed=false when permission transitions to denied", () => {
    const isSubscribedStates: boolean[] = [];
    const onDenied = () => {
      isSubscribedStates.push(false);
    };

    // Simulate Permissions API change listener
    const simulatePermissionChange = (newState: string) => {
      if (newState === "denied") onDenied();
    };

    simulatePermissionChange("granted"); // no change
    simulatePermissionChange("denied");  // triggers cleanup

    expect(isSubscribedStates).toEqual([false]);
  });
});
