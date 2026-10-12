/**
 * CircadianOptimizer.ts
 * Maps the user's current time-of-day and biological clock preferences to optimal lighting conditions.
 * Recommends venues or seating zones based on the analyzed ambient light.
 */

export const MIN_LUX = 10;
export const MAX_LUX = 100_000;
export const MIN_CCT = 2200; // Warm candle
export const MAX_CCT = 6500; // Daylight

export interface LightingProfile {
  cct: number; // Kelvin
  lux: number;
}

export interface CircadianRecommendation {
  suitabilityScore: number; // 0 to 100
  recommendation: string;
  suggestedAction: "STAY" | "MOVE_TO_WINDOW" | "USE_WARM_LAMP" | "TAKE_BREAK";
  recommendedCCT?: number;
}

/**
 * Clamps input illuminance readings between 10 lux and 100,000 lux.
 */
export function clampLux(lux: number): number {
  if (!Number.isFinite(lux)) {
    return MIN_LUX;
  }
  return Math.min(MAX_LUX, Math.max(MIN_LUX, lux));
}

/**
 * Clamps output correlated color temperature (CCT) between 2200K and 6500K.
 */
export function clampCCT(cct: number): number {
  if (!Number.isFinite(cct)) {
    return MIN_CCT;
  }
  return Math.min(MAX_CCT, Math.max(MIN_CCT, Math.round(cct)));
}

/**
 * Calculates recommended correlated color temperature (CCT) from ambient light illuminance (lux)
 * using a bounded logarithmic daylight estimation curve.
 *
 * Input illuminance is strictly clamped between 10 lux and 100,000 lux.
 * Output color temperature is strictly clamped between 2200K (warm candle) and 6500K (daylight).
 */
export function calculateRecommendedColorTemperature(lux: number): number {
  const clampedLux = clampLux(lux);

  const logMin = Math.log10(MIN_LUX); // 1.0
  const logMax = Math.log10(MAX_LUX); // 5.0
  const logCurrent = Math.log10(clampedLux);

  const ratio = (logCurrent - logMin) / (logMax - logMin);
  const estimatedCCT = MIN_CCT + ratio * (MAX_CCT - MIN_CCT);

  return clampCCT(estimatedCCT);
}

export class CircadianOptimizer {
  private userChronotype: "MORNING" | "INTERMEDIATE" | "EVENING";

  constructor(
    chronotype: "MORNING" | "INTERMEDIATE" | "EVENING" = "INTERMEDIATE",
  ) {
    this.userChronotype = chronotype;
  }

  /**
   * Static calculator for recommended color temperature based on ambient illuminance.
   */
  public static calculateRecommendedColorTemperature(lux: number): number {
    return calculateRecommendedColorTemperature(lux);
  }

  public static calculateRecommendedCCT(lux: number): number {
    return calculateRecommendedColorTemperature(lux);
  }

  public static recommendColorTemperature(lux: number): number {
    return calculateRecommendedColorTemperature(lux);
  }

  public static estimateColorTemperature(lux: number): number {
    return calculateRecommendedColorTemperature(lux);
  }

  /**
   * Instance method for calculating recommended color temperature.
   */
  public calculateRecommendedColorTemperature(lux: number): number {
    return calculateRecommendedColorTemperature(lux);
  }

  public calculateRecommendedCCT(lux: number): number {
    return calculateRecommendedColorTemperature(lux);
  }

  public recommendColorTemperature(lux: number): number {
    return calculateRecommendedColorTemperature(lux);
  }

  public estimateColorTemperature(lux: number): number {
    return calculateRecommendedColorTemperature(lux);
  }

  /**
   * Evaluates the current lighting conditions against circadian rhythm best practices.
   */
  public evaluate(
    profile: LightingProfile,
    currentHour: number,
  ): CircadianRecommendation {
    let score = 100;
    let action: CircadianRecommendation["suggestedAction"] = "STAY";
    let recommendation =
      "Lighting conditions are optimal for your current task.";

    const recommendedCCT = this.calculateRecommendedColorTemperature(
      profile.lux,
    );

    // Morning (6 AM - 12 PM): Need high CCT (cool/blue) and high lux for alertness
    if (currentHour >= 6 && currentHour < 12) {
      if (profile.cct < 4000) {
        score -= 30;
        action = "MOVE_TO_WINDOW";
        recommendation =
          "Morning light is too warm. Seek natural daylight or cool white lighting to boost alertness.";
      }
      if (profile.lux < 300) {
        score -= 20;
        recommendation +=
          " Additionally, the space is too dim for focused morning work.";
      }
    }
    // Afternoon (12 PM - 6 PM): Moderate CCT and lux
    else if (currentHour >= 12 && currentHour < 18) {
      if (profile.cct > 6000) {
        score -= 15;
        recommendation =
          "Lighting is excessively cool for the afternoon. Consider a warmer setting to reduce eye strain.";
      }
    }
    // Evening (6 PM - 10 PM): Need low CCT (warm) and lower lux to prepare for sleep
    else if (currentHour >= 18 && currentHour < 22) {
      if (profile.cct > 3500) {
        score -= 40;
        action = "USE_WARM_LAMP";
        recommendation =
          "Evening light is too blue, which can disrupt melatonin production. Use a warm desk lamp or move to a dimmer area.";
      }
      if (profile.lux > 500) {
        score -= 20;
        action = "TAKE_BREAK";
        recommendation +=
          " The space is too bright for winding down. Consider taking a screen break.";
      }
    }

    return {
      suitabilityScore: Math.max(0, score),
      recommendation,
      suggestedAction: action,
      recommendedCCT,
    };
  }
}
