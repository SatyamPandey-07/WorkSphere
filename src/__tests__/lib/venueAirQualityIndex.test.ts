/**
 * Tests for venue indoor air quality index calculation.
 */

interface AirQualityReading {
  co2Ppm: number;
  pm25: number;          // µg/m³ PM2.5 particles
  vocIndex: number;      // 0-500 VOC index
  humidity: number;      // 0-100%
  temperature: number;   // Celsius
}

function pm25AQI(pm25: number): number {
  // Simplified AQI calculation for PM2.5
  if (pm25 <= 12) return Math.round((pm25 / 12) * 50);
  if (pm25 <= 35.4) return Math.round(50 + ((pm25 - 12) / (35.4 - 12)) * 50);
  if (pm25 <= 55.4) return Math.round(100 + ((pm25 - 35.4) / (55.4 - 35.4)) * 50);
  return Math.round(150 + ((pm25 - 55.4) / (150.4 - 55.4)) * 100);
}

function overallAirQualityIndex(reading: AirQualityReading): number {
  const aqiPm25 = pm25AQI(reading.pm25);
  const aqiCo2 = Math.min(500, Math.round((reading.co2Ppm / 5000) * 500));
  const aqiVoc = reading.vocIndex;
  return Math.round((aqiPm25 + aqiCo2 + aqiVoc) / 3);
}

function airQualityCategory(aqi: number): "good" | "moderate" | "unhealthy" | "hazardous" {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 200) return "unhealthy";
  return "hazardous";
}

function isComfortableAir(reading: AirQualityReading): boolean {
  return (
    reading.humidity >= 30 && reading.humidity <= 60 &&
    reading.temperature >= 18 && reading.temperature <= 26 &&
    reading.co2Ppm < 1000 &&
    reading.pm25 < 12
  );
}

const GOOD_AIR: AirQualityReading = { co2Ppm: 500, pm25: 5, vocIndex: 20, humidity: 45, temperature: 22 };
const POOR_AIR: AirQualityReading = { co2Ppm: 2000, pm25: 40, vocIndex: 200, humidity: 75, temperature: 28 };

describe("Venue air quality index", () => {
  it("pm25AQI: 5 µg/m³ → low AQI", () => {
    expect(pm25AQI(5)).toBeLessThan(50);
  });

  it("pm25AQI: 0 → 0", () => {
    expect(pm25AQI(0)).toBe(0);
  });

  it("overallAirQualityIndex: good air → low AQI", () => {
    expect(overallAirQualityIndex(GOOD_AIR)).toBeLessThan(100);
  });

  it("overallAirQualityIndex: poor air → high AQI", () => {
    expect(overallAirQualityIndex(POOR_AIR)).toBeGreaterThan(100);
  });

  it("airQualityCategory: AQI 30 → good", () => {
    expect(airQualityCategory(30)).toBe("good");
  });

  it("airQualityCategory: AQI 75 → moderate", () => {
    expect(airQualityCategory(75)).toBe("moderate");
  });

  it("airQualityCategory: AQI 300 → hazardous", () => {
    expect(airQualityCategory(300)).toBe("hazardous");
  });

  it("isComfortableAir: good air → true", () => {
    expect(isComfortableAir(GOOD_AIR)).toBe(true);
  });

  it("isComfortableAir: poor air → false", () => {
    expect(isComfortableAir(POOR_AIR)).toBe(false);
  });
});
