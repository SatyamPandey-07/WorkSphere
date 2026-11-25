/**
 * CircadianLightingController.ts
 * Biodynamic Circadian Lighting Controller & Photobiological Melanopic Modulator.
 * Regulates Correlated Color Temperature (CCT), Photopic Lux, and Equivalent Melanopic Lux (EML)
 * according to CIE S 026 / WELL Building Standard to optimize diurnal cognitive alertness,
 * melatonin preservation, and sleep-wake cycle synchronization.
 */

export type UserChronotype = 'EARLY_LARK' | 'INTERMEDIATE' | 'NIGHT_OWL';

export type DiurnalPhase =
  | 'NIGHT'
  | 'DAWN_TWILIGHT'
  | 'MORNING_RAMP'
  | 'SOLAR_NOON_PEAK'
  | 'AFTERNOON_FOCUS'
  | 'EVENING_GOLDEN'
  | 'WIND_DOWN';

export interface CircadianLightTarget {
  cctKelvin: number;
  photopicLux: number;
  equivalentMelanopicLux: number;
  melanopicRatio: number;
  circadianStimulusScore: number; // 0.0 to 0.7 (Rea et al. CS model approximation)
  diurnalPhase: DiurnalPhase;
}

export interface LuminaireCommand {
  luminaireId: string;
  cctKelvin: number;
  dimmingPercent: number; // 0 to 100
  transitionDurationMs: number;
}

export interface FocusBurstConfig {
  active: boolean;
  startedAt: number;
  durationMs: number;
  targetCct: number;
  targetLux: number;
}

export class CircadianLightingController {
  private activeFocusBurst: FocusBurstConfig | null = null;
  private defaultTransitionMs = 900000; // 15-minute smooth optical ramp

  constructor(options?: { defaultTransitionMs?: number }) {
    if (options?.defaultTransitionMs) {
      this.defaultTransitionMs = options.defaultTransitionMs;
    }
  }

  /**
   * Computes the melanopic-to-photopic ratio (M/P) and Equivalent Melanopic Lux (EML)
   * conforming to CIE S 026 / WELL Building Standard v2 (Feature L03)
   */
  public computeEquivalentMelanopicLux(
    photopicLux: number,
    cctKelvin: number
  ): { eml: number; melanopicRatio: number } {
    // Interpolated empirical melanopic ratio for standard Planckian/daylight locus spectra
    const clampedCct = Math.max(2000, Math.min(7000, cctKelvin));
    const normalized = (clampedCct - 2000) / 5000.0;
    const melanopicRatio = parseFloat((0.42 + normalized * 0.65).toFixed(3)); // 0.42 at 2000K, ~1.07 at 7000K

    const eml = parseFloat((photopicLux * melanopicRatio).toFixed(1));
    return { eml, melanopicRatio };
  }

  /**
   * Evaluates the circadian light target based on astronomical time, diurnal curve, and chronotype
   */
  public calculateCircadianTarget(
    date: Date = new Date(),
    chronotype: UserChronotype = 'INTERMEDIATE'
  ): CircadianLightTarget {
    // 1. Check for Active Deep Focus Burst
    const now = date.getTime();
    if (this.activeFocusBurst && this.activeFocusBurst.active) {
      const elapsed = now - this.activeFocusBurst.startedAt;
      if (elapsed < this.activeFocusBurst.durationMs) {
        const cct = this.activeFocusBurst.targetCct;
        const lux = this.activeFocusBurst.targetLux;
        const { eml, melanopicRatio } = this.computeEquivalentMelanopicLux(lux, cct);
        return {
          cctKelvin: cct,
          photopicLux: lux,
          equivalentMelanopicLux: eml,
          melanopicRatio,
          circadianStimulusScore: 0.55,
          diurnalPhase: 'AFTERNOON_FOCUS',
        };
      } else {
        this.activeFocusBurst = null;
      }
    }

    // 2. Chronotype Phase Shift in Decimal Hours
    let phaseShiftHours = 0;
    if (chronotype === 'EARLY_LARK') phaseShiftHours = -1.5; // Peak 1.5h earlier
    if (chronotype === 'NIGHT_OWL') phaseShiftHours = 2.0; // Peak 2h later

    const hourDecimal = date.getHours() + date.getMinutes() / 60.0 + date.getSeconds() / 3600.0;
    let adjustedHour = (hourDecimal - phaseShiftHours + 24) % 24;

    let diurnalPhase: DiurnalPhase = 'NIGHT';
    let cct = 2200;
    let lux = 100;

    // Diurnal progression:
    // 00:00 - 06:00: NIGHT (2200K, 100 Lux)
    // 06:00 - 08:30: DAWN_TWILIGHT / MORNING_RAMP (2700K -> 4500K, 200 -> 500 Lux)
    // 08:30 - 13:00: SOLAR_NOON_PEAK (5500K -> 6500K, 650 -> 850 Lux)
    // 13:00 - 17:30: AFTERNOON_FOCUS (5000K -> 4000K, 600 -> 450 Lux)
    // 17:30 - 20:30: EVENING_GOLDEN (3200K -> 2700K, 300 -> 180 Lux)
    // 20:30 - 24:00: WIND_DOWN (2400K -> 2200K, 120 -> 80 Lux)

    if (adjustedHour >= 6.0 && adjustedHour < 8.5) {
      diurnalPhase = 'DAWN_TWILIGHT';
      const progress = (adjustedHour - 6.0) / 2.5;
      cct = Math.round(2700 + progress * (4500 - 2700));
      lux = Math.round(200 + progress * (500 - 200));
    } else if (adjustedHour >= 8.5 && adjustedHour < 13.0) {
      diurnalPhase = 'SOLAR_NOON_PEAK';
      const progress = (adjustedHour - 8.5) / 4.5;
      const peakBell = Math.sin(progress * Math.PI); // Peak at midpoint ~10:45
      cct = Math.round(5200 + peakBell * 1300); // Up to 6500K
      lux = Math.round(650 + peakBell * 200); // Up to 850 Lux
    } else if (adjustedHour >= 13.0 && adjustedHour < 17.5) {
      diurnalPhase = 'AFTERNOON_FOCUS';
      const progress = (adjustedHour - 13.0) / 4.5;
      cct = Math.round(5000 - progress * (5000 - 3800));
      lux = Math.round(600 - progress * (600 - 400));
    } else if (adjustedHour >= 17.5 && adjustedHour < 20.5) {
      diurnalPhase = 'EVENING_GOLDEN';
      const progress = (adjustedHour - 17.5) / 3.0;
      cct = Math.round(3200 - progress * (3200 - 2700));
      lux = Math.round(300 - progress * (300 - 160));
    } else if (adjustedHour >= 20.5 && adjustedHour < 23.5) {
      diurnalPhase = 'WIND_DOWN';
      const progress = (adjustedHour - 20.5) / 3.0;
      cct = Math.round(2500 - progress * (2500 - 2200));
      lux = Math.round(140 - progress * (140 - 80));
    } else {
      diurnalPhase = 'NIGHT';
      cct = 2200;
      lux = 80;
    }

    const { eml, melanopicRatio } = this.computeEquivalentMelanopicLux(lux, cct);

    // Circadian Stimulus (CS) approximation: Rea et al. sigmoid curve
    const csScore = parseFloat((0.7 * (1 - 1 / (1 + Math.pow(eml / 250.0, 1.2)))).toFixed(3));

    return {
      cctKelvin: cct,
      photopicLux: lux,
      equivalentMelanopicLux: eml,
      melanopicRatio,
      circadianStimulusScore: csScore,
      diurnalPhase,
    };
  }

  /**
   * Initiates a temporary high-alertness Deep Focus Burst
   */
  public triggerFocusBurst(
    durationMinutes: number = 45,
    targetCct: number = 5800,
    targetLux: number = 750
  ): void {
    this.activeFocusBurst = {
      active: true,
      startedAt: Date.now(),
      durationMs: durationMinutes * 60 * 1000,
      targetCct,
      targetLux,
    };
  }

  public cancelFocusBurst(): void {
    this.activeFocusBurst = null;
  }

  /**
   * Generates actionable luminaire dimming and CCT control signals for connected lighting fixtures
   */
  public generateLuminaireCommands(
    luminaires: { id: string; maxLuxRating: number }[],
    date: Date = new Date(),
    chronotype?: UserChronotype
  ): LuminaireCommand[] {
    const target = this.calculateCircadianTarget(date, chronotype);

    return luminaires.map((lum) => {
      const dimming = Math.min(100, Math.max(10, Math.round((target.photopicLux / lum.maxLuxRating) * 100)));
      return {
        luminaireId: lum.id,
        cctKelvin: target.cctKelvin,
        dimmingPercent: dimming,
        transitionDurationMs: this.defaultTransitionMs,
      };
    });
  }
}
