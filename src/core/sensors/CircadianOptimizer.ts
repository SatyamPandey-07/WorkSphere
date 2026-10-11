/**
 * CircadianOptimizer.ts
 * Maps the user's current time-of-day and biological clock preferences to optimal lighting conditions.
 * Recommends venues or seating zones based on the analyzed ambient light.
 */

export interface LightingProfile {
  cct: number; // Kelvin
  lux: number;
}

export interface CircadianRecommendation {
  suitabilityScore: number; // 0 to 100
  recommendation: string;
  suggestedAction: 'STAY' | 'MOVE_TO_WINDOW' | 'USE_WARM_LAMP' | 'TAKE_BREAK';
}

export class CircadianOptimizer {
  private userChronotype: 'MORNING' | 'INTERMEDIATE' | 'EVENING';

  constructor(chronotype: 'MORNING' | 'INTERMEDIATE' | 'EVENING' = 'INTERMEDIATE') {
    this.userChronotype = chronotype;
  }

  /**
   * Evaluates the current lighting conditions against circadian rhythm best practices.
   */
  public evaluate(profile: LightingProfile, currentHour: number): CircadianRecommendation {
    let score = 100;
    let action: CircadianRecommendation['suggestedAction'] = 'STAY';
    let recommendation = 'Lighting conditions are optimal for your current task.';

    // Morning (6 AM - 12 PM): Need high CCT (cool/blue) and high lux for alertness
    if (currentHour >= 6 && currentHour < 12) {
      if (profile.cct < 4000) {
        score -= 30;
        action = 'MOVE_TO_WINDOW';
        recommendation = 'Morning light is too warm. Seek natural daylight or cool white lighting to boost alertness.';
      }
      if (profile.lux < 300) {
        score -= 20;
        recommendation += ' Additionally, the space is too dim for focused morning work.';
      }
    }
    // Afternoon (12 PM - 6 PM): Moderate CCT and lux
    else if (currentHour >= 12 && currentHour < 18) {
      if (profile.cct > 6000) {
        score -= 15;
        recommendation = 'Lighting is excessively cool for the afternoon. Consider a warmer setting to reduce eye strain.';
      }
    }
    // Evening (6 PM - 10 PM): Need low CCT (warm) and lower lux to prepare for sleep
    else if (currentHour >= 18 && currentHour < 22) {
      if (profile.cct > 3500) {
        score -= 40;
        action = 'USE_WARM_LAMP';
        recommendation = 'Evening light is too blue, which can disrupt melatonin production. Use a warm desk lamp or move to a dimmer area.';
      }
      if (profile.lux > 500) {
        score -= 20;
        action = 'TAKE_BREAK';
        recommendation += ' The space is too bright for winding down. Consider taking a screen break.';
      }
    }

    return {
      suitabilityScore: Math.max(0, score),
      recommendation,
      suggestedAction: action
    };
  }
}
