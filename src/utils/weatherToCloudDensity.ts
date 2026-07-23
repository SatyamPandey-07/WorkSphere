/**
 * Weather API integration and mapping utilities for WebGL Volumetric Cloud Renderer.
 * Maps live weather metrics (cloud cover %, humidity %, rain %, weather code) to GLSL shader uniforms.
 */

export interface WeatherData {
  cloudCover: number; // Percentage 0 - 100
  humidity: number; // Percentage 0 - 100
  rainProbability: number; // Percentage 0 - 100
  weatherCondition: string; // e.g. "clear", "partly_cloudy", "cloudy", "rainy", "stormy"
  weatherCode?: number; // WMO weather code (0-99)
  windSpeed?: number; // km/h
  isDaytime?: boolean; // true = day, false = night
  temperature?: number; // Celsius
}

export interface CloudShaderUniforms {
  cloudCoverage: number; // 0.0 to 1.0
  humidity: number; // 0.0 to 1.0
  rainFactor: number; // 0.0 to 1.0
  windSpeed: number; // Speed multiplier
  lightDir: [number, number, number];
  lightColor: [number, number, number];
  skyTopColor: [number, number, number];
  skyBottomColor: [number, number, number];
}

/**
 * Fallback weather data when live weather is unavailable
 */
export const DEFAULT_MOCK_WEATHER: WeatherData = {
  cloudCover: 45,
  humidity: 60,
  rainProbability: 15,
  weatherCondition: "partly_cloudy",
  weatherCode: 2,
  windSpeed: 12,
  isDaytime: true,
  temperature: 22,
};

/**
 * Map WMO weather code to condition string
 */
export function mapWMOCodeToCondition(code: number): string {
  if (code === 0) return "clear";
  if (code >= 1 && code <= 3) return "partly_cloudy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 67) return "rainy";
  if (code >= 71 && code <= 77) return "snowy";
  if (code >= 80 && code <= 82) return "rainy";
  if (code >= 95 && code <= 99) return "stormy";
  return "cloudy";
}

/**
 * Convert weather data into WebGL shader uniforms
 */
export function weatherToCloudUniforms(
  data?: Partial<WeatherData> | null,
): CloudShaderUniforms {
  const weather: WeatherData = {
    ...DEFAULT_MOCK_WEATHER,
    ...data,
  };

  const cloudCoverage = Math.min(1.0, Math.max(0.0, weather.cloudCover / 100));
  const humidity = Math.min(1.0, Math.max(0.0, weather.humidity / 100));
  const rainFactor = Math.min(
    1.0,
    Math.max(0.0, weather.rainProbability / 100),
  );
  const windSpeed = Math.max(0.2, (weather.windSpeed || 10) / 10.0);

  const isDay = weather.isDaytime ?? true;

  // Sky and lighting adaptation
  const lightDir: [number, number, number] = isDay
    ? [0.4, 0.8, 0.45]
    : [-0.2, 0.5, -0.6];
  let lightColor: [number, number, number] = isDay
    ? [1.0, 0.95, 0.85]
    : [0.25, 0.35, 0.6];
  let skyTopColor: [number, number, number] = isDay
    ? [0.22, 0.48, 0.88]
    : [0.03, 0.05, 0.15];
  let skyBottomColor: [number, number, number] = isDay
    ? [0.68, 0.82, 0.96]
    : [0.08, 0.12, 0.25];

  // Adjust for rainy or stormy conditions
  if (weather.weatherCondition === "stormy" || rainFactor > 0.6) {
    lightColor = [0.45, 0.45, 0.55];
    skyTopColor = [0.12, 0.15, 0.22];
    skyBottomColor = [0.25, 0.28, 0.35];
  } else if (weather.weatherCondition === "clear" && cloudCoverage < 0.15) {
    lightColor = [1.0, 0.98, 0.9];
    skyTopColor = [0.18, 0.52, 0.95];
  }

  return {
    cloudCoverage,
    humidity,
    rainFactor,
    windSpeed,
    lightDir,
    lightColor,
    skyTopColor,
    skyBottomColor,
  };
}

/**
 * Fetch live weather from Open-Meteo free public API
 */
export async function fetchLiveVenueWeather(
  lat?: number,
  lng?: number,
): Promise<WeatherData> {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    isNaN(lat) ||
    isNaN(lng)
  ) {
    return DEFAULT_MOCK_WEATHER;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,is_day,precipitation,rain,showers,weather_code,cloud_cover,wind_speed_10m`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return DEFAULT_MOCK_WEATHER;
    }

    const data = await response.json();
    const current = data.current || {};

    const cloudCover =
      typeof current.cloud_cover === "number" ? current.cloud_cover : 45;
    const humidity =
      typeof current.relative_humidity_2m === "number"
        ? current.relative_humidity_2m
        : 60;
    const rain =
      typeof current.rain === "number" ||
      typeof current.precipitation === "number"
        ? Math.min(100, (current.rain || current.precipitation) > 0 ? 75 : 10)
        : 10;
    const code =
      typeof current.weather_code === "number" ? current.weather_code : 2;
    const isDaytime = current.is_day !== 0;

    return {
      cloudCover,
      humidity,
      rainProbability: rain,
      weatherCondition: mapWMOCodeToCondition(code),
      weatherCode: code,
      windSpeed: current.wind_speed_10m || 10,
      isDaytime,
      temperature: current.temperature_2m || 20,
    };
  } catch (err) {
    console.warn("[Weather] Fetch live weather failed, using fallback:", err);
    return DEFAULT_MOCK_WEATHER;
  }
}
