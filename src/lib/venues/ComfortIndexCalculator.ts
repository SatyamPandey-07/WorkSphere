export type ComfortCategory = 'too_cold' | 'ideal' | 'too_warm' | 'humid';

export interface ComfortResult {
  score: number; // 0 to 100
  category: ComfortCategory;
  badgeText: string;
  temperature: number; // in Celsius
  humidity: number;    // percentage
}

/**
 * Calculates ASHRAE Standard 55 thermal comfort index based on dry-bulb temperature (°C) and relative humidity (%).
 */
export function calculateComfortIndex(temperature: number, humidity: number): ComfortResult {
  // Ideal ASHRAE comfort ranges: Temp 20°C - 24.5°C, Humidity 30% - 60%
  let tempDeviation = 0;
  if (temperature < 20) {
    tempDeviation = 20 - temperature;
  } else if (temperature > 24.5) {
    tempDeviation = temperature - 24.5;
  }

  let humidityDeviation = 0;
  if (humidity < 30) {
    humidityDeviation = 30 - humidity;
  } else if (humidity > 60) {
    humidityDeviation = humidity - 60;
  }

  // Calculate penalty score (max 100 deduction)
  const penalty = tempDeviation * 12 + humidityDeviation * 0.8;
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  // Determine category
  let category: ComfortCategory = 'ideal';
  if (humidity > 70) {
    category = 'humid';
  } else if (temperature < 19) {
    category = 'too_cold';
  } else if (temperature > 26) {
    category = 'too_warm';
  }

  // Badge text formatting
  let statusWord = 'Optimal';
  if (score < 60) statusWord = 'Uncomfortable';
  else if (score < 80) statusWord = 'Acceptable';

  const badgeText = `${statusWord} ${score}/100 Thermal Comfort (${temperature}°C, ${humidity}% Humidity)`;

  return {
    score,
    category,
    badgeText,
    temperature,
    humidity,
  };
}