/**
 * Tests for venue booking weather impact modeling on attendance and revenue.
 */

type WeatherCondition = "sunny" | "partly_cloudy" | "overcast" | "light_rain" | "heavy_rain" | "storm" | "snow";

interface WeatherForecast {
  date: string;
  condition: WeatherCondition;
  tempCelsius: number;
  precipitation: number;  // mm
  windSpeedKmh: number;
  isOutdoorVenue: boolean;
}

const WEATHER_ATTENDANCE_MULTIPLIER: Record<WeatherCondition, { indoor: number; outdoor: number }> = {
  sunny:         { indoor: 1.0,  outdoor: 1.2 },
  partly_cloudy: { indoor: 1.0,  outdoor: 1.0 },
  overcast:      { indoor: 1.0,  outdoor: 0.9 },
  light_rain:    { indoor: 0.95, outdoor: 0.7 },
  heavy_rain:    { indoor: 0.85, outdoor: 0.4 },
  storm:         { indoor: 0.7,  outdoor: 0.1 },
  snow:          { indoor: 0.8,  outdoor: 0.3 },
};

function attendanceMultiplier(forecast: WeatherForecast): number {
  const mult = WEATHER_ATTENDANCE_MULTIPLIER[forecast.condition];
  return forecast.isOutdoorVenue ? mult.outdoor : mult.indoor;
}

function adjustedAttendance(baseAttendance: number, forecast: WeatherForecast): number {
  return Math.round(baseAttendance * attendanceMultiplier(forecast));
}

function isHighRiskWeather(forecast: WeatherForecast): boolean {
  return forecast.condition === "storm" || forecast.condition === "heavy_rain" ||
    forecast.windSpeedKmh > 60;
}

function weatherRiskScore(forecast: WeatherForecast): number {
  let score = 0;
  if (forecast.condition === "storm")      score += 40;
  else if (forecast.condition === "heavy_rain") score += 25;
  else if (forecast.condition === "snow")  score += 20;
  else if (forecast.condition === "light_rain") score += 10;
  if (forecast.windSpeedKmh > 60) score += 20;
  if (forecast.windSpeedKmh > 40) score += 10;
  if (forecast.isOutdoorVenue) score *= 1.5;
  return Math.min(Math.round(score), 100);
}

function recommendCoverage(forecast: WeatherForecast): string {
  const score = weatherRiskScore(forecast);
  if (score >= 70) return "mandatory_insurance";
  if (score >= 40) return "recommended_insurance";
  if (score >= 20) return "contingency_plan";
  return "standard";
}

const SUNNY_OUTDOOR:  WeatherForecast = { date: "2026-11-01", condition: "sunny",      tempCelsius: 22, precipitation: 0,  windSpeedKmh: 10, isOutdoorVenue: true };
const STORM_OUTDOOR:  WeatherForecast = { date: "2026-11-02", condition: "storm",       tempCelsius: 12, precipitation: 45, windSpeedKmh: 80, isOutdoorVenue: true };
const RAIN_INDOOR:    WeatherForecast = { date: "2026-11-03", condition: "heavy_rain",  tempCelsius: 15, precipitation: 25, windSpeedKmh: 30, isOutdoorVenue: false };

describe("Weather impact modeling", () => {
  it("attendanceMultiplier: sunny outdoor = 1.2", () => {
    expect(attendanceMultiplier(SUNNY_OUTDOOR)).toBe(1.2);
  });

  it("adjustedAttendance: 100 guests × 1.2 = 120", () => {
    expect(adjustedAttendance(100, SUNNY_OUTDOOR)).toBe(120);
  });

  it("isHighRiskWeather: storm → true", () => {
    expect(isHighRiskWeather(STORM_OUTDOOR)).toBe(true);
  });

  it("isHighRiskWeather: sunny → false", () => {
    expect(isHighRiskWeather(SUNNY_OUTDOOR)).toBe(false);
  });

  it("recommendCoverage: storm outdoor → mandatory", () => {
    expect(recommendCoverage(STORM_OUTDOOR)).toBe("mandatory_insurance");
  });

  it("recommendCoverage: sunny outdoor → standard", () => {
    expect(recommendCoverage(SUNNY_OUTDOOR)).toBe("standard");
  });

  it("weatherRiskScore: rain indoor lower than storm outdoor", () => {
    expect(weatherRiskScore(RAIN_INDOOR)).toBeLessThan(weatherRiskScore(STORM_OUTDOOR));
  });
});
