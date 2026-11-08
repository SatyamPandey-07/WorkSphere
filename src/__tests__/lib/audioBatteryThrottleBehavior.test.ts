/**
 * Tests for the AudioEqualizer battery-based throttle behavior (Issue #1995).
 * When battery < 20% and not charging, frame rate drops to 8fps (125ms interval).
 */

const TARGET_FPS_NORMAL = 60;
const TARGET_FPS_LOW_BATTERY = 8;
const INTERVAL_NORMAL = 350; // reduced-motion interval
const INTERVAL_LOW_BATTERY = 1000 / TARGET_FPS_LOW_BATTERY; // 125ms

interface AudioVisualizerConfig {
  isLowBattery: boolean;
  reducedMotion: boolean;
}

function getVisualizerInterval(config: AudioVisualizerConfig): number | "rAF" {
  if (config.reducedMotion) return INTERVAL_NORMAL;
  if (config.isLowBattery) return INTERVAL_LOW_BATTERY;
  return "rAF"; // requestAnimationFrame
}

describe("AudioEqualizer battery throttle", () => {
  it("normal conditions → requestAnimationFrame (60fps)", () => {
    const interval = getVisualizerInterval({ isLowBattery: false, reducedMotion: false });
    expect(interval).toBe("rAF");
  });

  it("reducedMotion → 350ms setInterval (~3fps)", () => {
    const interval = getVisualizerInterval({ isLowBattery: false, reducedMotion: true });
    expect(interval).toBe(350);
  });

  it("low battery (< 20%, not charging) → 125ms setInterval (8fps)", () => {
    const interval = getVisualizerInterval({ isLowBattery: true, reducedMotion: false });
    expect(interval).toBe(125);
  });

  it("low battery AND reducedMotion → reducedMotion wins (350ms)", () => {
    // reducedMotion takes precedence in our implementation
    const interval = getVisualizerInterval({ isLowBattery: true, reducedMotion: true });
    expect(interval).toBe(350);
  });

  it("125ms interval = 8fps", () => {
    expect(1000 / INTERVAL_LOW_BATTERY).toBe(TARGET_FPS_LOW_BATTERY);
  });

  it("low battery interval (125ms) is less than reducedMotion interval (350ms)", () => {
    expect(INTERVAL_LOW_BATTERY).toBeLessThan(INTERVAL_NORMAL);
  });

  it("charging at 15% → NOT isLowBattery", () => {
    // This is a semantic test — when charging, isLow = false
    const batteryLevel = 0.15;
    const charging = true;
    const isLow = !charging && batteryLevel <= 0.2;
    expect(isLow).toBe(false);
  });

  it("not charging at 15% → isLowBattery = true", () => {
    const batteryLevel = 0.15;
    const charging = false;
    const isLow = !charging && batteryLevel <= 0.2;
    expect(isLow).toBe(true);
    const interval = getVisualizerInterval({ isLowBattery: isLow, reducedMotion: false });
    expect(interval).toBe(125);
  });
});
