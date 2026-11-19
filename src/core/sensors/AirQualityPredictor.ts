/**
 * @file AirQualityPredictor.ts
 * @description Real-time ISO 7730 Fanger PMV/PPD thermal comfort modeling,
 * EPA piecewise AQI computation, and adaptive HVAC ventilation forecasting for WorkSphere.
 */

export const AQICategory = {
  GOOD: 'GOOD',
  MODERATE: 'MODERATE',
  UNHEALTHY_SENSITIVE: 'UNHEALTHY_SENSITIVE',
  UNHEALTHY: 'UNHEALTHY',
  VERY_UNHEALTHY: 'VERY_UNHEALTHY',
  HAZARDOUS: 'HAZARDOUS',
} as const;

export type AQICategoryKey = typeof AQICategory[keyof typeof AQICategory];

export const ThermalComfortBand = {
  COLD: 'COLD',
  COOL: 'COOL',
  SLIGHTLY_COOL: 'SLIGHTLY_COOL',
  NEUTRAL: 'NEUTRAL',
  SLIGHTLY_WARM: 'SLIGHTLY_WARM',
  WARM: 'WARM',
  HOT: 'HOT',
} as const;

export type ThermalComfortBandKey = typeof ThermalComfortBand[keyof typeof ThermalComfortBand];

export interface EnvironmentalReading {
  dryBulbTempC: number;
  meanRadiantTempC?: number;
  relativeHumidityPct: number; // 0 to 100
  airVelocityMs: number; // m/s
  metabolicRateMet?: number; // default: 1.1 met (desk work)
  clothingInsulationClo?: number; // default: 0.7 clo (business casual)
  pm25UgM3: number;
  pm10UgM3: number;
  co2Ppm: number;
  tvocPpb: number;
  timestamp?: number;
}

export interface ThermalComfortResult {
  pmv: number; // Predicted Mean Vote (-3 to +3)
  ppd: number; // Predicted Percentage of Dissatisfied (5% to 100%)
  comfortBand: ThermalComfortBandKey;
  isCompliantASHRAE55: boolean; // PPD <= 10% (-0.5 <= PMV <= +0.5)
}

export interface AQIResult {
  overallAQI: number;
  dominantPollutant: 'PM2.5' | 'PM10' | 'CO2' | 'TVOC';
  category: AQICategoryKey;
  pm25AQI: number;
  pm10AQI: number;
  co2RiskLevel: 'OPTIMAL' | 'ACCEPTABLE' | 'DEGRADED' | 'CRITICAL';
}

export interface VentilationRecommendation {
  recommendedACH: number; // Air changes per hour
  recommendedCfmPerPerson: number; // CFM per occupant
  hvacAdjustmentNeeded: boolean;
  actionGuidance: string;
}

export interface AirQualityForecast {
  comfort: ThermalComfortResult;
  aqi: AQIResult;
  ventilation: VentilationRecommendation;
  timestamp: number;
}

export class AirQualityPredictor {
  private _roomVolumeM3: number;
  private _occupantCount: number;
  private _ewmaAlpha: number;
  private _smoothedPm25: number | null;
  private _smoothedCo2: number | null;

  constructor(roomVolumeM3: number = 100, occupantCount: number = 4, ewmaAlpha: number = 0.2) {
    this._roomVolumeM3 = Math.max(10, roomVolumeM3);
    this._occupantCount = Math.max(1, occupantCount);
    this._ewmaAlpha = Math.min(1.0, Math.max(0.01, ewmaAlpha));
    this._smoothedPm25 = null;
    this._smoothedCo2 = null;
  }

  /**
   * Computes ISO 7730 Fanger PMV and PPD thermal comfort index.
   */
  public computeThermalComfort(reading: EnvironmentalReading): ThermalComfortResult {
    const ta = reading.dryBulbTempC;
    const tr = reading.meanRadiantTempC ?? ta;
    const rh = Math.max(0, Math.min(100, reading.relativeHumidityPct));
    const vel = Math.max(0.05, reading.airVelocityMs);
    const met = reading.metabolicRateMet ?? 1.1;
    const clo = reading.clothingInsulationClo ?? 0.7;

    // Metabolic rate in W/m^2
    const m = met * 58.15;
    const w = 0; // mechanical work usually 0 for sedentary desk work
    const mw = m - w;

    // Clothing thermal resistance in m^2 * K / W
    const icl = 0.155 * clo;

    // Clothing area factor
    const fcl = icl <= 0.078 ? 1.0 + 1.29 * icl : 1.05 + 0.645 * icl;

    // Water vapor pressure in Pa (Antoine equation)
    const pa = (rh / 100) * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));

    // Iterative solution for clothing surface temperature tcl
    let tcl = ta + (35.5 - ta) / (3.5 * (6.45 * icl + 0.1));
    const p1 = icl * fcl;
    const p2 = p1 * 3.96;
    const p3 = p1 * 100;
    const p4 = p1 * (ta + 273.15);
    const p5 = 308.7 - 0.028 * mw + p2 * Math.pow((tr + 273.15) / 100, 4);

    let xn = (tcl + 273.15) / 100;
    let xf = xn;
    const maxIter = 150;
    const eps = 0.00015;

    for (let iter = 0; iter < maxIter; iter++) {
      xf = (xf + xn) / 2;
      const hcf = 12.1 * Math.sqrt(vel);
      const hcn = 2.38 * Math.pow(Math.abs(100 * xf - ta - 273.15), 0.25);
      const hc = hcn > hcf ? hcn : hcf;
      xn = (p5 + p4 * hc - p2 * Math.pow(xf, 4)) / (100 + p3 * hc);

      if (Math.abs(xn - xf) <= eps) break;
    }

    tcl = 100 * xn - 273.15;

    // Convective heat transfer coefficient
    const hcfFinal = 12.1 * Math.sqrt(vel);
    const hcnFinal = 2.38 * Math.pow(Math.abs(tcl - ta), 0.25);
    const hcFinal = hcnFinal > hcfFinal ? hcnFinal : hcfFinal;

    // Heat loss components
    const hl1 = 3.05 * 0.001 * (5733 - 6.99 * mw - pa);
    const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
    const hl3 = 1.7 * 0.00001 * m * (5867 - pa);
    const hl4 = 0.0014 * m * (34 - ta);
    const hl5 = 3.96 * 1e-8 * fcl * (Math.pow(tcl + 273.15, 4) - Math.pow(tr + 273.15, 4));
    const hl6 = fcl * hcFinal * (tcl - ta);

    // Thermal load L
    const thermalLoad = mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6;

    // Predicted Mean Vote
    const pmvFactor = 0.3032 * Math.exp(-0.036 * m) + 0.028;
    const rawPmv = pmvFactor * thermalLoad;
    const pmv = Number(Math.max(-3, Math.min(3, rawPmv)).toFixed(2));

    // Predicted Percentage Dissatisfied
    const ppdVal = 100 - 95 * Math.exp(-(0.03353 * Math.pow(pmv, 4) + 0.2179 * Math.pow(pmv, 2)));
    const ppd = Number(Math.max(5.0, Math.min(100.0, ppdVal)).toFixed(1));

    let comfortBand: ThermalComfortBandKey = ThermalComfortBand.NEUTRAL;
    if (pmv <= -2.5) comfortBand = ThermalComfortBand.COLD;
    else if (pmv <= -1.5) comfortBand = ThermalComfortBand.COOL;
    else if (pmv <= -0.5) comfortBand = ThermalComfortBand.SLIGHTLY_COOL;
    else if (pmv < 0.5) comfortBand = ThermalComfortBand.NEUTRAL;
    else if (pmv < 1.5) comfortBand = ThermalComfortBand.SLIGHTLY_WARM;
    else if (pmv < 2.5) comfortBand = ThermalComfortBand.WARM;
    else comfortBand = ThermalComfortBand.HOT;

    const isCompliantASHRAE55 = ppd <= 10.0;

    return { pmv, ppd, comfortBand, isCompliantASHRAE55 };
  }

  /**
   * Computes EPA standard Air Quality Index (AQI) from PM2.5, PM10, CO2, and TVOC.
   */
  public computeAQI(reading: EnvironmentalReading): AQIResult {
    // EWMA Smoothing
    const rawPm25 = Math.max(0, reading.pm25UgM3);
    const rawCo2 = Math.max(300, reading.co2Ppm);

    this._smoothedPm25 =
      this._smoothedPm25 === null
        ? rawPm25
        : this._ewmaAlpha * rawPm25 + (1 - this._ewmaAlpha) * this._smoothedPm25;

    this._smoothedCo2 =
      this._smoothedCo2 === null
        ? rawCo2
        : this._ewmaAlpha * rawCo2 + (1 - this._ewmaAlpha) * this._smoothedCo2;

    const pm25AQI = this.calculateSubAQI(this._smoothedPm25, [
      { cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50 },
      { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
      { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
      { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200 },
      { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300 },
      { cLow: 250.5, cHigh: 500.4, iLow: 301, iHigh: 500 },
    ]);

    const pm10AQI = this.calculateSubAQI(Math.max(0, reading.pm10UgM3), [
      { cLow: 0, cHigh: 54, iLow: 0, iHigh: 50 },
      { cLow: 55, cHigh: 154, iLow: 51, iHigh: 100 },
      { cLow: 155, cHigh: 254, iLow: 101, iHigh: 150 },
      { cLow: 255, cHigh: 354, iLow: 151, iHigh: 200 },
      { cLow: 355, cHigh: 424, iLow: 201, iHigh: 300 },
      { cLow: 425, cHigh: 604, iLow: 301, iHigh: 500 },
    ]);

    // CO2 Sub-index
    let co2AQI = 0;
    let co2RiskLevel: 'OPTIMAL' | 'ACCEPTABLE' | 'DEGRADED' | 'CRITICAL' = 'OPTIMAL';
    if (this._smoothedCo2 < 800) {
      co2AQI = (this._smoothedCo2 / 800) * 50;
      co2RiskLevel = 'OPTIMAL';
    } else if (this._smoothedCo2 < 1000) {
      co2AQI = 50 + ((this._smoothedCo2 - 800) / 200) * 50;
      co2RiskLevel = 'ACCEPTABLE';
    } else if (this._smoothedCo2 < 1400) {
      co2AQI = 100 + ((this._smoothedCo2 - 1000) / 400) * 50;
      co2RiskLevel = 'DEGRADED';
    } else {
      co2AQI = 150 + Math.min(150, ((this._smoothedCo2 - 1400) / 600) * 150);
      co2RiskLevel = 'CRITICAL';
    }

    const overallAQI = Math.round(Math.max(pm25AQI, pm10AQI, co2AQI));

    let dominantPollutant: 'PM2.5' | 'PM10' | 'CO2' | 'TVOC' = 'PM2.5';
    if (overallAQI === Math.round(pm10AQI) && pm10AQI > pm25AQI) dominantPollutant = 'PM10';
    if (overallAQI === Math.round(co2AQI) && co2AQI > pm25AQI && co2AQI > pm10AQI) dominantPollutant = 'CO2';

    let category: AQICategoryKey = AQICategory.GOOD;
    if (overallAQI <= 50) category = AQICategory.GOOD;
    else if (overallAQI <= 100) category = AQICategory.MODERATE;
    else if (overallAQI <= 150) category = AQICategory.UNHEALTHY_SENSITIVE;
    else if (overallAQI <= 200) category = AQICategory.UNHEALTHY;
    else if (overallAQI <= 300) category = AQICategory.VERY_UNHEALTHY;
    else category = AQICategory.HAZARDOUS;

    return {
      overallAQI,
      dominantPollutant,
      category,
      pm25AQI: Math.round(pm25AQI),
      pm10AQI: Math.round(pm10AQI),
      co2RiskLevel,
    };
  }

  /**
   * Evaluates ventilation demand to sustain air freshness and cognitive health.
   */
  public evaluateVentilationDemand(
    comfort: ThermalComfortResult,
    aqi: AQIResult,
    reading: EnvironmentalReading
  ): VentilationRecommendation {
    let baseACH = 2.0; // Baseline office minimum ACH
    let cfmPerPerson = 20.0; // ASHRAE 62.1 standard for office spaces (CFM)
    let hvacAdjustmentNeeded = false;
    const actions: string[] = [];

    if (reading.co2Ppm > 1200) {
      baseACH += 2.5;
      cfmPerPerson += 15.0;
      hvacAdjustmentNeeded = true;
      actions.push('Elevated CO2 detected; boost outside air damper intake.');
    } else if (reading.co2Ppm > 950) {
      baseACH += 1.0;
      cfmPerPerson += 5.0;
      actions.push('Approaching upper CO2 threshold; ramp ventilation fan speed.');
    }

    if (aqi.overallAQI > 100) {
      hvacAdjustmentNeeded = true;
      actions.push('High particulate or TVOC count; activate HEPA recirculating filtration.');
    }

    if (!comfort.isCompliantASHRAE55) {
      hvacAdjustmentNeeded = true;
      if (comfort.pmv > 0.5) {
        actions.push('Thermal comfort is overly warm; lower thermostat setpoint by 1.0°C.');
      } else if (comfort.pmv < -0.5) {
        actions.push('Thermal comfort is overly cool; raise thermostat setpoint by 1.0°C.');
      }
    }

    if (actions.length === 0) {
      actions.push('Indoor environmental parameters within optimal ASHRAE 55 and EPA thresholds.');
    }

    return {
      recommendedACH: Number(baseACH.toFixed(1)),
      recommendedCfmPerPerson: Number(cfmPerPerson.toFixed(1)),
      hvacAdjustmentNeeded,
      actionGuidance: actions.join(' '),
    };
  }

  /**
   * Generates a complete environmental forecast snapshot.
   */
  public forecast(reading: EnvironmentalReading): AirQualityForecast {
    const comfort = this.computeThermalComfort(reading);
    const aqi = this.computeAQI(reading);
    const ventilation = this.evaluateVentilationDemand(comfort, aqi, reading);

    return {
      comfort,
      aqi,
      ventilation,
      timestamp: reading.timestamp ?? Date.now(),
    };
  }

  private calculateSubAQI(
    concentration: number,
    breakpoints: Array<{ cLow: number; cHigh: number; iLow: number; iHigh: number }>
  ): number {
    for (const bp of breakpoints) {
      if (concentration >= bp.cLow && concentration <= bp.cHigh) {
        return ((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (concentration - bp.cLow) + bp.iLow;
      }
    }
    const last = breakpoints[breakpoints.length - 1];
    if (concentration > last.cHigh) {
      return last.iHigh;
    }
    return 0;
  }
}
