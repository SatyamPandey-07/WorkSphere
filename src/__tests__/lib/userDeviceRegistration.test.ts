/**
 * Tests for user device registration and push token management.
 */

type DevicePlatform = "ios" | "android" | "web";

interface RegisteredDevice {
  deviceId: string;
  userId: string;
  platform: DevicePlatform;
  pushToken: string;
  registeredAt: number;
  lastActiveAt: number;
  isActive: boolean;
}

function registerDevice(
  existing: RegisteredDevice[],
  device: RegisteredDevice
): RegisteredDevice[] {
  const idx = existing.findIndex((d) => d.deviceId === device.deviceId);
  if (idx !== -1) {
    return existing.map((d, i) =>
      i === idx ? { ...d, pushToken: device.pushToken, lastActiveAt: device.lastActiveAt } : d
    );
  }
  return [...existing, device];
}

function deactivateDevice(
  devices: RegisteredDevice[],
  deviceId: string
): RegisteredDevice[] {
  return devices.map((d) => (d.deviceId === deviceId ? { ...d, isActive: false } : d));
}

function activeDevicesForUser(
  devices: RegisteredDevice[],
  userId: string
): RegisteredDevice[] {
  return devices.filter((d) => d.userId === userId && d.isActive);
}

function stalePushTokens(
  devices: RegisteredDevice[],
  nowMs: number,
  staleMs = 30 * 86_400_000 // 30 days
): RegisteredDevice[] {
  return devices.filter((d) => d.isActive && nowMs - d.lastActiveAt > staleMs);
}

const NOW = 1_700_000_000_000;
const DEVICES: RegisteredDevice[] = [
  { deviceId: "d1", userId: "u1", platform: "ios",     pushToken: "tok1", registeredAt: NOW - 100_000, lastActiveAt: NOW - 1000, isActive: true  },
  { deviceId: "d2", userId: "u1", platform: "android", pushToken: "tok2", registeredAt: NOW - 200_000, lastActiveAt: NOW - 45 * 86_400_000, isActive: true }, // stale
  { deviceId: "d3", userId: "u2", platform: "web",     pushToken: "tok3", registeredAt: NOW - 50_000,  lastActiveAt: NOW - 5000, isActive: false },
];

describe("User device registration", () => {
  it("registerDevice: adds new device", () => {
    const newDev: RegisteredDevice = { deviceId: "d4", userId: "u2", platform: "ios", pushToken: "tok4", registeredAt: NOW, lastActiveAt: NOW, isActive: true };
    expect(registerDevice(DEVICES, newDev)).toHaveLength(4);
  });

  it("registerDevice: updates existing device token", () => {
    const updated = { ...DEVICES[0], pushToken: "new-tok" };
    const result = registerDevice(DEVICES, updated);
    expect(result.find((d) => d.deviceId === "d1")!.pushToken).toBe("new-tok");
    expect(result).toHaveLength(3);
  });

  it("deactivateDevice sets isActive false", () => {
    const result = deactivateDevice(DEVICES, "d1");
    expect(result.find((d) => d.deviceId === "d1")!.isActive).toBe(false);
  });

  it("activeDevicesForUser: u1 has 2 active (d1, d2)", () => {
    expect(activeDevicesForUser(DEVICES, "u1")).toHaveLength(2);
  });

  it("activeDevicesForUser: u2 has 0 active (d3 is inactive)", () => {
    expect(activeDevicesForUser(DEVICES, "u2")).toHaveLength(0);
  });

  it("stalePushTokens: d2 is stale (45 days)", () => {
    const stale = stalePushTokens(DEVICES, NOW);
    expect(stale.map((d) => d.deviceId)).toContain("d2");
  });

  it("stalePushTokens: active recent device not stale", () => {
    const stale = stalePushTokens(DEVICES, NOW);
    expect(stale.map((d) => d.deviceId)).not.toContain("d1");
  });
});
