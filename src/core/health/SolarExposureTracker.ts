/**
 * SolarExposureTracker.ts
 * Fuses local weather APIs and device ambient light sensors to track cumulative
 * lux exposure and validate the recovery schedule against the Phase Response Curve.
 */

export interface LuxReading {
  timestamp: number;
  lux: number;
  source: 'sensor' | 'weather_api';
}

export interface SolarExposureState {
  cumulativeLuxHours: number;
  targetLuxHours: number;
  isOnTrack: boolean;
  currentBlockStatus: 'under' | 'optimal' | 'over' | 'inactive';
  progressPercentage: number;
}

export class SolarExposureTracker {
  private readings: LuxReading[] = [];
  private targetLux: number;
  private windowStart: number;
  private windowEnd: number;
  private readonly MAX_LUX_THRESHOLD = 100000; // Direct sunlight cap

  constructor(targetLux: number, windowStartHour: number, windowEndHour: number) {
    this.targetLux = Math.min(targetLux, this.MAX_LUX_THRESHOLD);
    this.windowStart = windowStartHour;
    this.windowEnd = windowEndHour;
  }

  /**
   * Ingests a new lux reading and prunes stale data to maintain memory efficiency.
   */
  public addReading(reading: LuxReading): void {
    if (reading.lux < 0) reading.lux = 0;
    this.readings.push(reading);
    this.pruneOldReadings();
  }

  private pruneOldReadings(): void {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    this.readings = this.readings.filter(r => r.timestamp > oneDayAgo);
  }

  /**
   * Calculates the current state of light exposure relative to the biological target.
   */
  public getCurrentState(currentHour: number): SolarExposureState {
    if (!this.isHourInWindow(currentHour)) {
      const isPast = this.isPastWindow(currentHour);
      return {
        cumulativeLuxHours: this.getTotalIntegratedLux(),
        targetLuxHours: this.calculateTargetLuxHours(),
        isOnTrack: isPast ? this.getTotalIntegratedLux() >= this.calculateTargetLuxHours() * 0.9 : true,
        currentBlockStatus: isPast ? 'optimal' : 'inactive',
        progressPercentage: isPast ? 100 : 0
      };
    }

    const relevantReadings = this.getReadingsInWindow();
    const cumulativeLuxHours = this.integrateLux(relevantReadings);
    const targetLuxHours = this.calculateTargetLuxHours();
    
    const progress = this.calculateWindowProgress(currentHour);
    const expectedLuxHours = targetLuxHours * progress;
    
    const isOnTrack = cumulativeLuxHours >= expectedLuxHours * 0.8 && cumulativeLuxHours <= expectedLuxHours * 1.2;
    let status: 'under' | 'optimal' | 'over' = 'optimal';
    
    if (cumulativeLuxHours < expectedLuxHours * 0.8) status = 'under';
    if (cumulativeLuxHours > expectedLuxHours * 1.2) status = 'over';

    return {
      cumulativeLuxHours,
      targetLuxHours,
      isOnTrack,
      currentBlockStatus: status,
      progressPercentage: Math.round((cumulativeLuxHours / targetLuxHours) * 100)
    };
  }

  private getReadingsInWindow(): LuxReading[] {
    return this.readings.filter(r => {
      const hour = new Date(r.timestamp).getHours() + (new Date(r.timestamp).getMinutes() / 60);
      return this.isHourInWindow(hour);
    });
  }

  private isHourInWindow(hour: number): boolean {
    if (this.windowStart <= this.windowEnd) {
      return hour >= this.windowStart && hour < this.windowEnd;
    } else {
      return hour >= this.windowStart || hour < this.windowEnd;
    }
  }

  /**
   * Integrates lux over time using the trapezoidal rule to calculate Lux-Hours.
   */
  private integrateLux(readings: LuxReading[]): number {
    if (readings.length < 2) return 0;
    
    let totalLuxSeconds = 0;
    for (let i = 1; i < readings.length; i++) {
      const dt = (readings[i].timestamp - readings[i - 1].timestamp) / 1000;
      const avgLux = (readings[i].lux + readings[i - 1].lux) / 2;
      totalLuxSeconds += avgLux * dt;
    }
    
    return totalLuxSeconds / 3600;
  }

  private getTotalIntegratedLux(): number {
    return this.integrateLux(this.getReadingsInWindow());
  }

  private calculateTargetLuxHours(): number {
    let windowDuration = this.windowEnd - this.windowStart;
    if (windowDuration < 0) windowDuration += 24;
    return (this.targetLux * windowDuration) / 1000; // Normalized metric
  }

  private calculateWindowProgress(currentHour: number): number {
    let windowDuration = this.windowEnd - this.windowStart;
    if (windowDuration < 0) windowDuration += 24;

    let elapsed = currentHour - this.windowStart;
    if (elapsed < 0) elapsed += 24;

    return Math.min(elapsed / windowDuration, 1);
  }

  private isPastWindow(currentHour: number): boolean {
    if (this.windowStart <= this.windowEnd) {
      return currentHour >= this.windowEnd;
    } else {
      return currentHour >= this.windowEnd && currentHour < this.windowStart;
    }
  }

  /**
   * Fallback mechanism to inject weather API data if device sensors are occluded.
   */
  public fuseWeatherData(apiLuxEstimate: number, timestamp: number): void {
    const lastReading = this.readings[this.readings.length - 1];
    if (!lastReading || timestamp - lastReading.timestamp > 15 * 60 * 1000) {
      this.addReading({
        timestamp,
        lux: Math.min(apiLuxEstimate, this.MAX_LUX_THRESHOLD),
        source: 'weather_api'
      });
    }
  }

  public getRecommendation(state: SolarExposureState): string {
    if (state.currentBlockStatus === 'under') {
      return 'Seek direct sunlight or use a 10,000 lux SAD lamp for 30 minutes to advance phase.';
    }
    if (state.currentBlockStatus === 'over') {
      return 'Wear blue-blocking glasses and avoid direct light to prevent phase-advance overshoot.';
    }
    return 'Maintain current light exposure levels for optimal circadian entrainment.';
  }
}
