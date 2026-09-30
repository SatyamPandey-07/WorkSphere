/**
 * Tests for venue temperature zone configuration and comfort mapping.
 */

interface TemperatureZone {
  zoneId: string;
  venueName: string;
  targetTempCelsius: number;
  currentTempCelsius: number;
  humidity: number; // 0-100%
  hasIndividualControl: boolean;
}

function tempDeviation(zone: TemperatureZone): number {
  return Math.abs(zone.currentTempCelsius - zone.targetTempCelsius);
}

function isComfortableZone(zone: TemperatureZone): boolean {
  return (
    zone.currentTempCelsius >= 18 &&
    zone.currentTempCelsius <= 26 &&
    zone.humidity >= 30 &&
    zone.humidity <= 60 &&
    tempDeviation(zone) <= 2
  );
}

function zoneComfortScore(zone: TemperatureZone): number {
  const tempScore = Math.max(0, 10 - tempDeviation(zone) * 2);
  const humidityScore = zone.humidity >= 30 && zone.humidity <= 60 ? 10 : 5;
  const controlBonus = zone.hasIndividualControl ? 5 : 0;
  return Math.round(tempScore + humidityScore + controlBonus);
}

function needsAdjustment(zones: TemperatureZone[], maxDeviation = 1.5): TemperatureZone[] {
  return zones.filter((z) => tempDeviation(z) > maxDeviation);
}

const ZONE_GOOD: TemperatureZone = { zoneId: "z1", venueName: "v1", targetTempCelsius: 22, currentTempCelsius: 22, humidity: 45, hasIndividualControl: true  };
const ZONE_BAD:  TemperatureZone = { zoneId: "z2", venueName: "v1", targetTempCelsius: 22, currentTempCelsius: 27, humidity: 75, hasIndividualControl: false };

describe("Venue temperature zones", () => {
  it("tempDeviation: at target = 0", () => {
    expect(tempDeviation(ZONE_GOOD)).toBe(0);
  });

  it("tempDeviation: 5°C off target", () => {
    expect(tempDeviation(ZONE_BAD)).toBe(5);
  });

  it("isComfortableZone: ideal zone → true", () => {
    expect(isComfortableZone(ZONE_GOOD)).toBe(true);
  });

  it("isComfortableZone: high temp + humidity → false", () => {
    expect(isComfortableZone(ZONE_BAD)).toBe(false);
  });

  it("zoneComfortScore: good zone scores high", () => {
    expect(zoneComfortScore(ZONE_GOOD)).toBeGreaterThan(zoneComfortScore(ZONE_BAD));
  });

  it("zoneComfortScore: individual control adds bonus", () => {
    const withControl = zoneComfortScore(ZONE_GOOD);
    const noControl = zoneComfortScore({ ...ZONE_GOOD, hasIndividualControl: false });
    expect(withControl).toBeGreaterThan(noControl);
  });

  it("needsAdjustment: bad zone flagged", () => {
    const zones = [ZONE_GOOD, ZONE_BAD];
    const flagged = needsAdjustment(zones);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].zoneId).toBe("z2");
  });

  it("needsAdjustment: no zones flagged when within tolerance", () => {
    expect(needsAdjustment([ZONE_GOOD])).toHaveLength(0);
  });
});
