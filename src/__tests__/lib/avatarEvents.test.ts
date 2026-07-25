import {
  AVATAR_UPDATED_EVENT,
  dispatchAvatarUpdated,
  subscribeAvatarUpdated,
  AvatarUpdatedDetail,
} from "@/lib/avatar-events";

describe("avatar-events.ts CustomEvent Infrastructure", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("exports the correct CustomEvent constant name", () => {
    expect(AVATAR_UPDATED_EVENT).toBe("worksphere:avatar-updated");
  });

  it("dispatches CustomEvent on window with userId, avatarUrl, and timestamp", (done) => {
    const userId = "user_12345";
    const avatarUrl = "https://example.com/new-avatar.jpg";

    const listener = (event: Event) => {
      const customEvent = event as CustomEvent<AvatarUpdatedDetail>;
      expect(customEvent.type).toBe(AVATAR_UPDATED_EVENT);
      expect(customEvent.detail.userId).toBe(userId);
      expect(customEvent.detail.avatarUrl).toBe(avatarUrl);
      expect(typeof customEvent.detail.timestamp).toBe("number");
      window.removeEventListener(AVATAR_UPDATED_EVENT, listener);
      done();
    };

    window.addEventListener(AVATAR_UPDATED_EVENT, listener);
    dispatchAvatarUpdated(userId, avatarUrl);
  });

  it("invokes subscriber callback via subscribeAvatarUpdated", () => {
    const callback = jest.fn();
    const unsubscribe = subscribeAvatarUpdated(callback);

    dispatchAvatarUpdated("user_abc", "https://img.com/a.png");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_abc",
        avatarUrl: "https://img.com/a.png",
      }),
    );

    unsubscribe();
  });

  it("cleans up listener when unsubscribe function is called", () => {
    const callback = jest.fn();
    const unsubscribe = subscribeAvatarUpdated(callback);

    unsubscribe();
    dispatchAvatarUpdated("user_xyz", "https://img.com/b.png");

    expect(callback).not.toHaveBeenCalled();
  });
});
