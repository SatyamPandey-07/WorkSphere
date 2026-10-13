import { renderHook, act, waitFor } from "@testing-library/react";
import {
  FlightAttitudeFusion,
  useFlightAttitudeTracker,
} from "@/hooks/useFlightAttitudeTracker";

type Listener = (event: any) => void;

class FakeDeviceSensor {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  emit(type: string, event: any) {
    this.listeners.get(type)?.forEach((l) => l(event));
  }
}

let orientation: FakeDeviceSensor;
let motion: FakeDeviceSensor;
let timestamps: number;

function installSensorEnv(opts: {
  supportsMotion?: boolean;
  iosPermission?: boolean;
} = {}) {
  const { supportsMotion = true, iosPermission = false } = opts;

  orientation = new FakeDeviceSensor();
  motion = new FakeDeviceSensor();
  timestamps = 0;

  Object.defineProperty(window, "DeviceOrientationEvent", {
    configurable: true,
    value: iosPermission
      ? Object.assign(
        class {
          static requestPermission = jest
            .fn()
            .mockResolvedValue("granted" as const);
        },
        { requestPermission: jest.fn().mockResolvedValue("granted" as const) },
      )
      : class { },
    writable: true,
  });

  Object.defineProperty(window, "ondeviceorientationabsolute", {
    configurable: true,
    value: undefined,
    writable: true,
  });
  delete (window as any).ondeviceorientationabsolute;

  if (supportsMotion) {
    Object.defineProperty(window, "DeviceMotionEvent", {
      configurable: true,
      value: iosPermission
        ? Object.assign(class { }, {
          requestPermission: jest.fn().mockResolvedValue("granted" as const),
        })
        : class { },
      writable: true,
    });
  } else {
    Object.defineProperty(window, "DeviceMotionEvent", {
      configurable: true,
      value: undefined,
      writable: true,
    });
  }

  jest
    .spyOn(window, "addEventListener")
    .mockImplementation((type: string, listener: any) => {
      if (type === "deviceorientation") orientation.addEventListener(type, listener);
      else if (type === "devicemotion") motion.addEventListener(type, listener);
    });
  jest
    .spyOn(window, "removeEventListener")
    .mockImplementation((type: string, listener: any) => {
      if (type === "deviceorientation") orientation.removeEventListener(type, listener);
      else if (type === "devicemotion") motion.removeEventListener(type, listener);
    });

  jest.spyOn(window, "setInterval").mockReturnValue(1 as any);
  jest.spyOn(window, "clearInterval").mockImplementation(() => { });
}

/** Emit a deviceorientation event with the given Tait-Bryan angles. */
function emitOrientation(
  alpha: number | null,
  beta: number | null,
  gamma: number | null,
) {
  timestamps += 16;
  orientation.emit("deviceorientation", { alpha, beta, gamma, timeStamp: timestamps });
}

/** Emit a devicemotion event: gravity angles (deg) + rotation rates (deg/s). */
function emitMotion(
  pitchDeg: number,
  rollDeg: number,
  rates: { rx: number; ry: number; rz: number },
) {
  const p = pitchDeg * (Math.PI / 180);
  const r = rollDeg * (Math.PI / 180);
  const g = 9.81;
  // Device pointing "up" (screen up): gravity vector under pitch/roll rotation.
  const ax = g * Math.sin(p);
  const ay = -g * Math.sin(r) * Math.cos(p);
  const az = -g * Math.cos(r) * Math.cos(p);
  timestamps += 16;
  motion.emit("devicemotion", {
    accelerationIncludingGravity: { x: ax, y: ay, z: az },
    rotationRate: { alpha: rates.rx, beta: rates.ry, gamma: rates.rz },
    timeStamp: timestamps,
  });
}

function advancePolling() {
  act(() => {
    (jest.mocked(window.setInterval).mock.calls[0]?.[0] as () => void)?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  installSensorEnv();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FlightAttitudeFusion (pure filter)", () => {
  it("converges accelerometer + gyro estimates toward the true attitude", () => {
    const fusion = new FlightAttitudeFusion(0.2);
    for (let i = 0; i < 200; i++) {
      fusion.updateMotion({ ax: null, ay: null, az: null, rx: 0, ry: 0, rz: 0 }, i * 16);
      fusion.updateMotion(
        {
          ax: 9.81 * Math.sin((20 * Math.PI) / 180),
          ay: 0,
          az: -9.81 * Math.cos((20 * Math.PI) / 180),
          rx: 0,
          ry: 0,
          rz: 0,
        },
        i * 16,
      );
    }
    const attitude = fusion.getAttitude();
    expect(attitude.pitch).toBeGreaterThan(15);
    expect(attitude.pitch).toBeLessThan(25);
  });

  it("rejects gimbal-lock spikes (±180 roll jumps near vertical)", () => {
    const fusion = new FlightAttitudeFusion(0.5);
    // Establish a near-vertical attitude.
    for (let i = 0; i < 50; i++) {
      fusion.updateMotion({ ax: 9.81, ay: 0, az: 0, rx: 0, ry: 0, rz: 0 }, i * 16);
    }
    const before = fusion.getAttitude().roll;

    // Ill-defined accelerometer near vertical flips sign: spike of ~180°.
    fusion.updateMotion({ ax: 9.81, ay: 0.01, az: -0.01, rx: 0, ry: 0, rz: 0 }, 1000);
    const after = fusion.getAttitude().roll;

    // The filter must clamp the correction, not absorb a 180° jump.
    expect(Math.abs(after - before)).toBeLessThan(10);
  });

  it("ignores accelerometer samples not consistent with gravity (free-fall / vibration)", () => {
    const fusion = new FlightAttitudeFusion(0.5);
    fusion.updateMotion({ ax: 0, ay: 0, az: -9.81, rx: 0, ry: 0, rz: 0 }, 0);
    const stable = fusion.getAttitude();

    // Zero-g free-fall reading must be ignored entirely.
    fusion.updateMotion({ ax: 0, ay: 0, az: 0, rx: 0, ry: 0, rz: 0 }, 16);
    expect(fusion.getAttitude()).toEqual(stable);

    // Violent vibration reading must be ignored.
    fusion.updateMotion({ ax: 40, ay: -40, az: 40, rx: 0, ry: 0, rz: 0 }, 32);
    expect(fusion.getAttitude()).toEqual(stable);
  });

  it("corrects yaw through the shortest angular path without ±360 wrap spikes", () => {
    const fusion = new FlightAttitudeFusion(0.1);
    fusion.updateOrientation({ alpha: 350 }); // heading 10°

    // Compass crosses north: 10° -> 350° is a -20° step, not +340°.
    fusion.updateOrientation({ alpha: 10 });
    const yaw = fusion.getAttitude().yaw;
    expect(yaw).toBeGreaterThan(8);
    expect(yaw).toBeLessThan(12);
  });

  it("integrates gyro rates over time", () => {
    const fusion = new FlightAttitudeFusion(0);
    // 30 deg/s roll rate for 1 second in ~60 frames.
    for (let i = 0; i < 60; i++) {
      fusion.updateMotion({ ax: 0, ay: 0, az: -9.81, rx: 0, ry: 30, rz: 0 }, i * 16);
    }
    expect(fusion.getAttitude().roll).toBeCloseTo(29, 0);
  });
});

describe("useFlightAttitudeTracker", () => {
  it("reports unsupported on devices without sensor APIs", () => {
    installSensorEnv({ supportsMotion: false });
    Object.defineProperty(window, "DeviceOrientationEvent", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    const { result } = renderHook(() => useFlightAttitudeTracker());

    expect(result.current.isSupported).toBe(false);
    expect(result.current.permissionState).toBe("unsupported");
    expect(result.current.attitude).toBeNull();
    expect(orientation.listenerCount("deviceorientation")).toBe(0);
  });

  it("attaches listeners and streams smoothed attitude without hardware permission gate", async () => {
    const { result } = renderHook(() => useFlightAttitudeTracker());

    expect(result.current.isSupported).toBe(true);
    expect(result.current.permissionState).toBe("granted");
    expect(orientation.listenerCount("deviceorientation")).toBe(1);
    expect(motion.listenerCount("devicemotion")).toBe(1);

    // Simulate a device held at ~20° pitch / ~10° roll with tiny sensor noise.
    for (let i = 0; i < 120; i++) {
      emitMotion(20, 10, { rx: 0, ry: 0, rz: 0 });
      emitOrientation(180, 20, 10); // heading 180°
    }
    advancePolling();

    await waitFor(() => expect(result.current.attitude).not.toBeNull());
    const attitude = result.current.attitude!;
    expect(attitude.pitch).toBeGreaterThan(14);
    expect(attitude.pitch).toBeLessThan(26);
    expect(attitude.roll).toBeGreaterThan(5);
    expect(attitude.roll).toBeLessThan(15);
    expect(attitude.yaw).toBeGreaterThan(170);
    expect(attitude.yaw).toBeLessThan(190);
    expect(result.current.isTracking).toBe(true);
  });

  it("filters jitter: noisy raw readings produce a monotone, spike-free output", () => {
    const { result } = renderHook(() => useFlightAttitudeTracker());

    // Warm up at 0°.
    for (let i = 0; i < 100; i++) {
      emitMotion(0, 0, { rx: 0, ry: 0, rz: 0 });
    }

    // Then inject alternating ±90° accelerometer spikes (gimbal-lock-style noise)
    // on top of an otherwise steady attitude.
    for (let i = 0; i < 60; i++) {
      if (i % 2 === 0) emitMotion(90, 90, { rx: 0, ry: 0, rz: 0 });
      else emitMotion(-90, -90, { rx: 0, ry: 0, rz: 0 });
    }
    advancePolling();

    const attitude = result.current.attitude!;
    // The complementary filter must have absorbed the spikes: output stays
    // near the steady-state attitude instead of following the noise.
    expect(Math.abs(attitude.pitch)).toBeLessThan(15);
    expect(Math.abs(attitude.roll)).toBeLessThan(15);
  });

  it("smooths a slow physical roll movement instead of snapping", () => {
    const { result } = renderHook(() => useFlightAttitudeTracker());

    for (let i = 0; i < 60; i++) emitMotion(0, 0, { rx: 0, ry: 0, rz: 0 });

    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      emitMotion(0, 20, { rx: 0, ry: 0, rz: 0 });
      advancePolling();
      samples.push(result.current.attitude?.roll ?? 0);
    }

    // Converges toward 20° and moves smoothly (no >5° jump between polls).
    expect(samples[samples.length - 1]).toBeGreaterThan(3);
    for (let i = 1; i < samples.length; i++) {
      expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(5);
    }
  });

  it("goes through the iOS permission gate before attaching listeners", async () => {
    installSensorEnv({ iosPermission: true });

    const { result } = renderHook(() => useFlightAttitudeTracker());

    expect(result.current.permissionState).toBe("prompt");
    expect(orientation.listenerCount("deviceorientation")).toBe(0);

    let granted: boolean | undefined;
    await act(async () => {
      granted = await result.current.requestPermission();
    });

    expect(granted).toBe(true);
    expect(result.current.permissionState).toBe("granted");
    expect(orientation.listenerCount("deviceorientation")).toBe(1);
    expect(motion.listenerCount("devicemotion")).toBe(1);
  });

  it("marks permission denied when the iOS gate rejects", async () => {
    installSensorEnv({ iosPermission: true });
    (window as any).DeviceOrientationEvent.requestPermission.mockResolvedValue(
      "denied",
    );
    (window as any).DeviceMotionEvent.requestPermission.mockResolvedValue("denied");

    const { result } = renderHook(() => useFlightAttitudeTracker());

    let granted: boolean | undefined;
    await act(async () => {
      granted = await result.current.requestPermission();
    });

    expect(granted).toBe(false);
    expect(result.current.permissionState).toBe("denied");
    expect(result.current.error).toBeTruthy();
    expect(orientation.listenerCount("deviceorientation")).toBe(0);
  });

  it("cleans up all event listeners on unmount", () => {
    const { result, unmount } = renderHook(() => useFlightAttitudeTracker());
    expect(orientation.listenerCount("deviceorientation")).toBe(1);
    expect(motion.listenerCount("devicemotion")).toBe(1);

    unmount();

    expect(orientation.listenerCount("deviceorientation")).toBe(0);
    expect(motion.listenerCount("devicemotion")).toBe(0);
    expect(result.current.isTracking).toBe(false);
  });

  it("stops updating attitude after unmount even when events keep firing", () => {
    const { result, unmount } = renderHook(() => useFlightAttitudeTracker());

    for (let i = 0; i < 50; i++) emitMotion(10, 0, { rx: 0, ry: 0, rz: 0 });
    advancePolling();
    const last = result.current.attitude?.pitch ?? null;
    expect(last).not.toBeNull();

    unmount();
    emitMotion(10, 0, { rx: 0, ry: 0, rz: 0 });
    advancePolling();

    expect(result.current.attitude?.pitch).toBe(last);
  });
});
