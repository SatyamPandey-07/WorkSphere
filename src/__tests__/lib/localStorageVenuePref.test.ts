/**
 * Tests for venue distance unit preference in localStorage.
 */

const DISTANCE_UNIT_KEY = "worksphere-distance-unit";
type DistanceUnit = "mi" | "km";

function getStoredDistanceUnit(): DistanceUnit {
  if (typeof window === "undefined") return "mi";
  const stored = window.localStorage.getItem(DISTANCE_UNIT_KEY);
  return stored === "km" ? "km" : "mi";
}

function setStoredDistanceUnit(unit: DistanceUnit): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DISTANCE_UNIT_KEY, unit);
  }
}

beforeEach(() => {
  localStorage.clear();
});

describe("Distance unit localStorage preference", () => {
  it("defaults to miles when no preference stored", () => {
    expect(getStoredDistanceUnit()).toBe("mi");
  });

  it("returns km when stored as km", () => {
    localStorage.setItem(DISTANCE_UNIT_KEY, "km");
    expect(getStoredDistanceUnit()).toBe("km");
  });

  it("returns mi when stored as mi", () => {
    localStorage.setItem(DISTANCE_UNIT_KEY, "mi");
    expect(getStoredDistanceUnit()).toBe("mi");
  });

  it("setStoredDistanceUnit persists km", () => {
    setStoredDistanceUnit("km");
    expect(localStorage.getItem(DISTANCE_UNIT_KEY)).toBe("km");
  });

  it("setStoredDistanceUnit persists mi", () => {
    setStoredDistanceUnit("mi");
    expect(localStorage.getItem(DISTANCE_UNIT_KEY)).toBe("mi");
  });

  it("invalid stored value falls back to mi", () => {
    localStorage.setItem(DISTANCE_UNIT_KEY, "invalid");
    expect(getStoredDistanceUnit()).toBe("mi");
  });

  it("toggling works correctly", () => {
    setStoredDistanceUnit("mi");
    const next = getStoredDistanceUnit() === "mi" ? "km" : "mi";
    setStoredDistanceUnit(next);
    expect(getStoredDistanceUnit()).toBe("km");
  });
});
