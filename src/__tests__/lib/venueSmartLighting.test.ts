/**
 * Tests for venue smart lighting control based on occupancy.
 */

type LightingZone = "entrance" | "workArea" | "meetingRoom" | "kitchen" | "restroom";

interface LightingState {
  zone: LightingZone;
  brightnessPercent: number; // 0-100
  colorTempKelvin: number;   // 2700-6500K
  isOn: boolean;
  occupancyDetected: boolean;
}

function autoAdjustBrightness(state: LightingState): LightingState {
  if (!state.occupancyDetected && state.isOn) {
    return { ...state, brightnessPercent: 10 }; // dim when empty
  }
  if (state.occupancyDetected) {
    const targetBrightness = state.zone === "workArea" ? 80 : 60;
    return { ...state, brightnessPercent: targetBrightness, isOn: true };
  }
  return state;
}

function autoColorTemp(state: LightingState, hourOfDay: number): LightingState {
  // Warmer in morning/evening, cooler midday
  const temp = hourOfDay >= 10 && hourOfDay < 16 ? 5000 : 3000;
  return { ...state, colorTempKelvin: temp };
}

function energySaving(states: LightingState[]): LightingState[] {
  return states.map((s) => ({
    ...s,
    brightnessPercent: s.occupancyDetected ? s.brightnessPercent : Math.min(s.brightnessPercent, 10),
  }));
}

function totalActiveLighting(states: LightingState[]): number {
  return states.filter((s) => s.isOn && s.occupancyDetected).length;
}

const STATES: LightingState[] = [
  { zone: "workArea",    brightnessPercent: 80, colorTempKelvin: 5000, isOn: true, occupancyDetected: true  },
  { zone: "meetingRoom", brightnessPercent: 60, colorTempKelvin: 4000, isOn: true, occupancyDetected: false },
  { zone: "kitchen",     brightnessPercent: 50, colorTempKelvin: 3000, isOn: true, occupancyDetected: false },
];

describe("Venue smart lighting", () => {
  it("autoAdjustBrightness: empty workArea dims to 10%", () => {
    const empty = { ...STATES[0], occupancyDetected: false };
    expect(autoAdjustBrightness(empty).brightnessPercent).toBe(10);
  });

  it("autoAdjustBrightness: occupied workArea → 80%", () => {
    const occupied = { ...STATES[1], zone: "workArea" as LightingZone, occupancyDetected: true };
    expect(autoAdjustBrightness(occupied).brightnessPercent).toBe(80);
  });

  it("autoAdjustBrightness: occupied other zone → 60%", () => {
    const occupied = { ...STATES[1], occupancyDetected: true };
    expect(autoAdjustBrightness(occupied).brightnessPercent).toBe(60);
  });

  it("autoColorTemp: midday (12pm) → 5000K cool", () => {
    expect(autoColorTemp(STATES[0], 12).colorTempKelvin).toBe(5000);
  });

  it("autoColorTemp: evening (18pm) → 3000K warm", () => {
    expect(autoColorTemp(STATES[0], 18).colorTempKelvin).toBe(3000);
  });

  it("energySaving: unoccupied zones dimmed", () => {
    const saved = energySaving(STATES);
    expect(saved[1].brightnessPercent).toBe(10); // unoccupied meeting room
    expect(saved[0].brightnessPercent).toBe(80); // occupied work area unchanged
  });

  it("totalActiveLighting: 1 zone with occupancy", () => {
    expect(totalActiveLighting(STATES)).toBe(1);
  });
});
