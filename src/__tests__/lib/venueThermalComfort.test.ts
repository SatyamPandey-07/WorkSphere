/**
 * Tests for venue thermal comfort classification (temperature + humidity).
 */

type ComfortLevel = "cold" | "cool" | "comfortable" | "warm" | "hot";

function classifyComfort(tempCelsius: number, humidityPct: number): ComfortLevel {
  // Heat index approximation
  const heatIndex = tempCelsius + 0.05 * humidityPct;
  if (heatIndex < 16) return "cold";
  if (heatIndex < 20) return "cool";
  if (heatIndex < 26) return "comfortable";
  if (heatIndex < 30) return "warm";
  return "hot";
}

function isIdealWorkspace(tempCelsius: number, humidityPct: number): boolean {
  return classifyComfort(tempCelsius, humidityPct) === "comfortable";
}

function humidityLevel(pct: number): "dry" | "comfortable" | "humid" {
  if (pct < 30) return "dry";
  if (pct < 60) return "comfortable";
  return "humid";
}

function tempDisplayString(celsius: number, unit: "C" | "F"): string {
  if (unit === "F") {
    const f = (celsius * 9) / 5 + 32;
    return `${Math.round(f)}°F`;
  }
  return `${celsius}°C`;
}

describe("Venue thermal comfort", () => {
  it("15°C, 50% humidity → cold", () => {
    expect(classifyComfort(15, 50)).toBe("cold");
  });

  it("22°C, 40% humidity → comfortable", () => {
    expect(classifyComfort(22, 40)).toBe("comfortable");
  });

  it("28°C, 50% humidity → warm", () => {
    expect(classifyComfort(28, 50)).toBe("warm");
  });

  it("35°C, 60% humidity → hot", () => {
    expect(classifyComfort(35, 60)).toBe("hot");
  });

  it("isIdealWorkspace: 21°C, 45% → true", () => {
    expect(isIdealWorkspace(21, 45)).toBe(true);
  });

  it("isIdealWorkspace: 30°C, 80% → false (hot)", () => {
    expect(isIdealWorkspace(30, 80)).toBe(false);
  });

  it("humidityLevel: 20% → dry", () => {
    expect(humidityLevel(20)).toBe("dry");
  });

  it("humidityLevel: 45% → comfortable", () => {
    expect(humidityLevel(45)).toBe("comfortable");
  });

  it("humidityLevel: 70% → humid", () => {
    expect(humidityLevel(70)).toBe("humid");
  });

  it("tempDisplayString: 20°C → 68°F", () => {
    expect(tempDisplayString(20, "F")).toBe("68°F");
  });

  it("tempDisplayString: 25°C displays as Celsius", () => {
    expect(tempDisplayString(25, "C")).toBe("25°C");
  });
});
