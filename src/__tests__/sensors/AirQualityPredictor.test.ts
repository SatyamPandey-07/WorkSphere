import { describe, it, expect, beforeEach } from 'vitest';
import {
  AirQualityPredictor,
  AQICategory,
  ThermalComfortBand,
  type EnvironmentalReading,
} from '../../core/sensors/AirQualityPredictor';

describe('AirQualityPredictor - ISO 7730 Thermal Comfort & EPA AQI Forecasting', () => {
  let predictor: AirQualityPredictor;

  beforeEach(() => {
    predictor = new AirQualityPredictor(120, 6, 0.3);
  });

  describe('Fanger PMV/PPD Thermal Comfort Modeling', () => {
    it('computes NEUTRAL thermal comfort within ASHRAE 55 envelope for 24.5°C standard room', () => {
      const reading: EnvironmentalReading = {
        dryBulbTempC: 24.5,
        relativeHumidityPct: 45,
        airVelocityMs: 0.1,
        metabolicRateMet: 1.1, // desk work
        clothingInsulationClo: 0.7, // business casual
        pm25UgM3: 8.0,
        pm10UgM3: 15.0,
        co2Ppm: 650,
        tvocPpb: 120,
      };

      const comfort = predictor.computeThermalComfort(reading);
      expect(comfort.pmv).toBeGreaterThanOrEqual(-0.5);
      expect(comfort.pmv).toBeLessThanOrEqual(0.5);
      expect(comfort.ppd).toBeLessThanOrEqual(10.0);
      expect(comfort.comfortBand).toBe(ThermalComfortBand.NEUTRAL);
      expect(comfort.isCompliantASHRAE55).toBe(true);
    });

    it('classifies COLD/COOL environment when ambient temperature drops to 16°C', () => {
      const coldReading: EnvironmentalReading = {
        dryBulbTempC: 16.0,
        relativeHumidityPct: 40,
        airVelocityMs: 0.15,
        metabolicRateMet: 1.0,
        clothingInsulationClo: 0.6,
        pm25UgM3: 10,
        pm10UgM3: 20,
        co2Ppm: 600,
        tvocPpb: 100,
      };

      const comfort = predictor.computeThermalComfort(coldReading);
      expect(comfort.pmv).toBeLessThan(-1.0);
      expect(comfort.ppd).toBeGreaterThan(25.0);
      expect(comfort.isCompliantASHRAE55).toBe(false);
      expect([ThermalComfortBand.COOL, ThermalComfortBand.COLD, ThermalComfortBand.SLIGHTLY_COOL]).toContain(
        comfort.comfortBand
      );
    });

    it('classifies WARM/HOT environment when temperature rises to 31°C', () => {
      const warmReading: EnvironmentalReading = {
        dryBulbTempC: 31.0,
        relativeHumidityPct: 65,
        airVelocityMs: 0.08,
        metabolicRateMet: 1.2,
        clothingInsulationClo: 0.6,
        pm25UgM3: 12,
        pm10UgM3: 25,
        co2Ppm: 750,
        tvocPpb: 150,
      };

      const comfort = predictor.computeThermalComfort(warmReading);
      expect(comfort.pmv).toBeGreaterThan(1.5);
      expect(comfort.isCompliantASHRAE55).toBe(false);
      expect([ThermalComfortBand.WARM, ThermalComfortBand.HOT]).toContain(comfort.comfortBand);
    });
  });

  describe('Multi-Pollutant EPA AQI Matrix', () => {
    it('rates pristine indoor air as GOOD (AQI <= 50)', () => {
      const cleanReading: EnvironmentalReading = {
        dryBulbTempC: 22.0,
        relativeHumidityPct: 50,
        airVelocityMs: 0.1,
        pm25UgM3: 6.0,
        pm10UgM3: 18.0,
        co2Ppm: 550,
        tvocPpb: 80,
      };

      const aqi = predictor.computeAQI(cleanReading);
      expect(aqi.category).toBe(AQICategory.GOOD);
      expect(aqi.overallAQI).toBeLessThanOrEqual(50);
      expect(aqi.co2RiskLevel).toBe('OPTIMAL');
    });

    it('detects high particulate PM2.5 pollution as UNHEALTHY_SENSITIVE or worse', () => {
      const pollutedReading: EnvironmentalReading = {
        dryBulbTempC: 22.0,
        relativeHumidityPct: 50,
        airVelocityMs: 0.1,
        pm25UgM3: 45.0, // PM2.5 in 35.5 - 55.4 range = 101 - 150
        pm10UgM3: 40.0,
        co2Ppm: 700,
        tvocPpb: 200,
      };

      const aqi = predictor.computeAQI(pollutedReading);
      expect(aqi.category).toBe(AQICategory.UNHEALTHY_SENSITIVE);
      expect(aqi.overallAQI).toBeGreaterThanOrEqual(101);
      expect(aqi.dominantPollutant).toBe('PM2.5');
    });

    it('identifies severe CO2 accumulation (> 1400 ppm) with critical risk alert', () => {
      const highCo2Reading: EnvironmentalReading = {
        dryBulbTempC: 23.0,
        relativeHumidityPct: 50,
        airVelocityMs: 0.1,
        pm25UgM3: 5.0,
        pm10UgM3: 10.0,
        co2Ppm: 1650,
        tvocPpb: 350,
      };

      const aqi = predictor.computeAQI(highCo2Reading);
      expect(aqi.co2RiskLevel).toBe('CRITICAL');
      expect(aqi.dominantPollutant).toBe('CO2');
    });
  });

  describe('Adaptive HVAC Ventilation Forecasting', () => {
    it('boosts air changes per hour (ACH) and recommends fresh air intake upon CO2 spike', () => {
      const spikeReading: EnvironmentalReading = {
        dryBulbTempC: 26.5,
        relativeHumidityPct: 60,
        airVelocityMs: 0.1,
        pm25UgM3: 38.0,
        pm10UgM3: 60.0,
        co2Ppm: 1350,
        tvocPpb: 400,
      };

      const forecast = predictor.forecast(spikeReading);
      expect(forecast.ventilation.hvacAdjustmentNeeded).toBe(true);
      expect(forecast.ventilation.recommendedACH).toBeGreaterThan(3.0);
      expect(forecast.ventilation.actionGuidance).toMatch(/outside air damper|ventilation/i);
    });
  });
});
