/**
 * Tests for venue CO2 monitoring and ventilation recommendations.
 */

type AirQualityLevel = "excellent" | "good" | "moderate" | "poor" | "hazardous";
type VentilationAction = "none" | "increase_airflow" | "open_windows" | "evacuate";

function co2AirQuality(ppm: number): AirQualityLevel {
  if (ppm < 400)  return "excellent";
  if (ppm < 700)  return "good";
  if (ppm < 1000) return "moderate";
  if (ppm < 2000) return "poor";
  return "hazardous";
}

function recommendedAction(ppm: number): VentilationAction {
  if (ppm < 700)  return "none";
  if (ppm < 1000) return "increase_airflow";
  if (ppm < 2000) return "open_windows";
  return "evacuate";
}

function co2PerPerson(totalPpm: number, backgroundPpm: number, occupancy: number): number {
  if (occupancy === 0) return 0;
  const excess = Math.max(0, totalPpm - backgroundPpm);
  return excess / occupancy;
}

function estimatedOccupancy(
  currentPpm: number,
  backgroundPpm: number,
  ppmPerPerson = 20
): number {
  const excess = Math.max(0, currentPpm - backgroundPpm);
  return Math.round(excess / ppmPerPerson);
}

describe("Venue CO2 monitoring", () => {
  it("co2AirQuality: 350ppm → excellent", () => {
    expect(co2AirQuality(350)).toBe("excellent");
  });

  it("co2AirQuality: 600ppm → good", () => {
    expect(co2AirQuality(600)).toBe("good");
  });

  it("co2AirQuality: 900ppm → moderate", () => {
    expect(co2AirQuality(900)).toBe("moderate");
  });

  it("co2AirQuality: 1500ppm → poor", () => {
    expect(co2AirQuality(1500)).toBe("poor");
  });

  it("co2AirQuality: 3000ppm → hazardous", () => {
    expect(co2AirQuality(3000)).toBe("hazardous");
  });

  it("recommendedAction: 500ppm → none", () => {
    expect(recommendedAction(500)).toBe("none");
  });

  it("recommendedAction: 800ppm → increase_airflow", () => {
    expect(recommendedAction(800)).toBe("increase_airflow");
  });

  it("recommendedAction: 2500ppm → evacuate", () => {
    expect(recommendedAction(2500)).toBe("evacuate");
  });

  it("co2PerPerson: 10 people, 200 excess ppm = 20 each", () => {
    expect(co2PerPerson(800, 600, 10)).toBe(20);
  });

  it("estimatedOccupancy: 1000ppm, background 400, 20ppm/person = 30", () => {
    expect(estimatedOccupancy(1000, 400, 20)).toBe(30);
  });
});
