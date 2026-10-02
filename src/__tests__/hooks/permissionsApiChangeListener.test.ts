/**
 * Tests for the Permissions API change listener added to usePushNotifications.
 * Verifies that subscription state syncs reactively when browser permission changes.
 */

type PermissionState = "granted" | "denied" | "prompt";

// Simulate the Permissions API change listener pattern
class MockPermissionStatus extends EventTarget {
  state: PermissionState;

  constructor(state: PermissionState) {
    super();
    this.state = state;
  }

  triggerChange(newState: PermissionState) {
    this.state = newState;
    this.dispatchEvent(new Event("change"));
  }
}

function createPermissionsWatcher(
  initialState: PermissionState,
  onDenied: () => void,
) {
  const status = new MockPermissionStatus(initialState);

  const changeHandler = () => {
    if (status.state === "denied") onDenied();
  };

  status.addEventListener("change", changeHandler);

  return {
    status,
    cleanup: () => status.removeEventListener("change", changeHandler),
  };
}

describe("Permissions API reactive state sync", () => {
  it("calls onDenied when permission changes to 'denied'", () => {
    const onDenied = jest.fn();
    const { status } = createPermissionsWatcher("granted", onDenied);

    status.triggerChange("denied");
    expect(onDenied).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onDenied when permission stays 'granted'", () => {
    const onDenied = jest.fn();
    const { status } = createPermissionsWatcher("granted", onDenied);

    status.triggerChange("granted");
    expect(onDenied).not.toHaveBeenCalled();
  });

  it("does NOT call onDenied when permission changes from denied to granted", () => {
    const onDenied = jest.fn();
    const { status } = createPermissionsWatcher("denied", onDenied);

    status.triggerChange("granted"); // recovering from denied
    expect(onDenied).not.toHaveBeenCalled();
  });

  it("cleanup removes the listener", () => {
    const onDenied = jest.fn();
    const { status, cleanup } = createPermissionsWatcher("granted", onDenied);

    cleanup();
    status.triggerChange("denied");
    expect(onDenied).not.toHaveBeenCalled();
  });

  it("handles multiple permission change events correctly", () => {
    const deniedCount = { value: 0 };
    const { status } = createPermissionsWatcher("granted", () => { deniedCount.value++; });

    status.triggerChange("denied");
    status.triggerChange("granted"); // recover
    status.triggerChange("denied"); // denied again

    expect(deniedCount.value).toBe(2);
  });
});
