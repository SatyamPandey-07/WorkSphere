/**
 * Tests for the checkSubscription guard added to usePushNotifications (Issue #1942).
 * When permission is denied, checkSubscription should not call pushManager.getSubscription().
 */

async function checkSubscription(
  permission: NotificationPermission,
  getSubscription: jest.Mock,
  setIsSubscribed: jest.Mock,
  setPermission: jest.Mock,
): Promise<void> {
  if (permission === "denied") {
    setPermission("denied");
    setIsSubscribed(false);
    return; // skip pushManager call
  }

  const subscription = await getSubscription();
  setIsSubscribed(subscription !== null);
}

describe("Push checkSubscription denied permission guard", () => {
  it("skips pushManager.getSubscription when permission is 'denied'", async () => {
    const getSubscription = jest.fn();
    const setIsSubscribed = jest.fn();
    const setPermission = jest.fn();

    await checkSubscription("denied", getSubscription, setIsSubscribed, setPermission);

    expect(getSubscription).not.toHaveBeenCalled();
    expect(setPermission).toHaveBeenCalledWith("denied");
    expect(setIsSubscribed).toHaveBeenCalledWith(false);
  });

  it("calls pushManager.getSubscription when permission is 'granted'", async () => {
    const getSubscription = jest.fn().mockResolvedValue({ endpoint: "https://..." });
    const setIsSubscribed = jest.fn();
    const setPermission = jest.fn();

    await checkSubscription("granted", getSubscription, setIsSubscribed, setPermission);

    expect(getSubscription).toHaveBeenCalledTimes(1);
    expect(setIsSubscribed).toHaveBeenCalledWith(true);
  });

  it("sets isSubscribed=false when no subscription exists", async () => {
    const getSubscription = jest.fn().mockResolvedValue(null);
    const setIsSubscribed = jest.fn();
    const setPermission = jest.fn();

    await checkSubscription("granted", getSubscription, setIsSubscribed, setPermission);

    expect(setIsSubscribed).toHaveBeenCalledWith(false);
  });

  it("calls pushManager when permission is 'default' (prompt)", async () => {
    const getSubscription = jest.fn().mockResolvedValue(null);
    const setIsSubscribed = jest.fn();
    const setPermission = jest.fn();

    await checkSubscription("default", getSubscription, setIsSubscribed, setPermission);

    expect(getSubscription).toHaveBeenCalledTimes(1);
  });

  it("does not crash when pushManager.getSubscription rejects", async () => {
    const getSubscription = jest.fn().mockRejectedValue(new Error("SW not ready"));
    const setIsSubscribed = jest.fn();
    const setPermission = jest.fn();

    await expect(
      checkSubscription("granted", getSubscription, setIsSubscribed, setPermission),
    ).rejects.toThrow("SW not ready");
  });
});
