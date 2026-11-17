import {
  AmbientNoiseDosimeter,
  AcousticSample,
} from '../../core/sensors/AmbientNoiseDosimeter';

describe('AmbientNoiseDosimeter', () => {
  let dosimeter: AmbientNoiseDosimeter;

  beforeEach(() => {
    dosimeter = new AmbientNoiseDosimeter();
  });

  describe('Sample Ingestion & Validation', () => {
    it('records valid acoustic sound samples', () => {
      dosimeter.recordSample({
        splDba: 45.0,
        timestamp: 1000,
        durationSec: 5,
      });

      const summary = dosimeter.getSummary();
      expect(summary.sampleCount).toBe(1);
      expect(summary.leqDba).toBe(45.0);
      expect(summary.lminDba).toBe(45.0);
      expect(summary.lmaxDba).toBe(45.0);
    });

    it('rejects physically out-of-range decibel levels', () => {
      expect(() => {
        dosimeter.recordSample({ splDba: -10, timestamp: 1000 });
      }).toThrow('Invalid sound level');

      expect(() => {
        dosimeter.recordSample({ splDba: 160, timestamp: 1000 });
      }).toThrow('Invalid sound level');
    });
  });

  describe('Leq Logarithmic Energy Integration', () => {
    it('averages sound levels energetically (3 dB doubling law)', () => {
      // Two equal duration samples of 70 dBA and 70 dBA -> Leq must be 70 dBA
      dosimeter.recordSample({ splDba: 70.0, durationSec: 10, timestamp: 1000 });
      dosimeter.recordSample({ splDba: 70.0, durationSec: 10, timestamp: 2000 });
      expect(dosimeter.computeLeq()).toBe(70.0);

      // In acoustics: 70 dBA + 70 dBA simultaneous energy doubles the sound power,
      // but sequential equal exposure over twice the time remains 70 dBA.
    });

    it('correctly weighs higher decibels more heavily due to logarithmic energy', () => {
      // 1 second of 90 dBA and 9 seconds of 60 dBA
      dosimeter.recordSample({ splDba: 90.0, durationSec: 1, timestamp: 1000 });
      dosimeter.recordSample({ splDba: 60.0, durationSec: 9, timestamp: 2000 });

      const leq = dosimeter.computeLeq();
      // Arithmetic average would be (90 + 9*60)/10 = 63 dBA
      // Logarithmic energy Leq = 10 * log10( (10^9 + 9 * 10^6) / 10 ) = 80.04 dBA
      expect(leq).toBeGreaterThan(79);
      expect(leq).toBeLessThan(81);
    });
  });

  describe('OSHA & NIOSH Occupational Noise Dosimetry', () => {
    it('accumulates OSHA and NIOSH daily dose at high decibel exposures', () => {
      // 4 hours (14400 sec) of 90 dBA exposure
      // Under OSHA: criterion 90 dBA, allowable 8 hours -> 4 hours = 50% dose
      dosimeter.recordSample({
        splDba: 90.0,
        durationSec: 14400,
        timestamp: 1000,
      });

      const summary = dosimeter.getSummary();
      expect(summary.oshaDosePercent).toBeCloseTo(50.0, 1);
      // Under NIOSH: criterion 85 dBA with 3 dB exchange rate -> 88 dBA is 4 hours, 91 dBA is 2 hours
      // At 90 dBA: allowable = 8 / 2^((90-85)/3) = 8 / 2^1.666 = ~2.519 hours -> 4 hours > 100%
      expect(summary.nioshDosePercent).toBeGreaterThan(100);
    });

    it('discards sub-threshold noise (<80 dBA) in occupational dose accumulation', () => {
      // 8 hours of 65 dBA (normal conversation/office)
      dosimeter.recordSample({
        splDba: 65.0,
        durationSec: 28800,
        timestamp: 1000,
      });

      const summary = dosimeter.getSummary();
      expect(summary.oshaDosePercent).toBe(0);
      expect(summary.nioshDosePercent).toBe(0);
      expect(summary.oshaTwaDba).toBe(0);
    });
  });

  describe('Cognitive Focus Score & Distraction Tiers', () => {
    it('awards high focus score (>90) for library-quiet environments', () => {
      dosimeter.recordSample({ splDba: 38.0, durationSec: 60, timestamp: 1000 });
      const summary = dosimeter.getSummary();
      expect(summary.cognitiveFocusScore).toBeGreaterThan(90);
      expect(summary.acousticTier).toBe('PRISTINE_FOCUS');
    });

    it('penalizes focus score when impulsive transient spikes occur (crest factor > 12 dB)', () => {
      // Background 50 dBA with a loud 80 dBA sudden transient door slam
      const steadyDosimeter = new AmbientNoiseDosimeter([
        { splDba: 50.0, peakDba: 54.0, durationSec: 10, timestamp: 1000 },
      ]);
      const spikeDosimeter = new AmbientNoiseDosimeter([
        { splDba: 50.0, peakDba: 75.0, durationSec: 10, timestamp: 1000 }, // Crest = 25 dB
      ]);

      const steadyScore = steadyDosimeter.computeCognitiveFocusScore();
      const spikeScore = spikeDosimeter.computeCognitiveFocusScore();

      expect(spikeScore).toBeLessThan(steadyScore);
    });
  });

  describe('IEC 61672-1 Weighting Curve Approximations', () => {
    it('calculates standard A-weighting attenuation across key frequencies', () => {
      // At 1000 Hz, A-weighting is defined as 0 dB
      expect(AmbientNoiseDosimeter.calculateAWeightingDb(1000)).toBeCloseTo(0.0, 1);

      // Low frequencies are heavily attenuated (100 Hz ~ -19.1 dB)
      expect(AmbientNoiseDosimeter.calculateAWeightingDb(100)).toBeLessThan(-15);

      // High frequencies around 2.5 kHz have slight human ear canal resonance boost
      expect(AmbientNoiseDosimeter.calculateAWeightingDb(2500)).toBeGreaterThan(1.0);
    });

    it('calculates C-weighting flat response across mid-band', () => {
      expect(AmbientNoiseDosimeter.calculateCWeightingDb(1000)).toBeCloseTo(0.0, 1);
      // C-weighting preserves low frequencies much more than A-weighting
      expect(AmbientNoiseDosimeter.calculateCWeightingDb(100)).toBeGreaterThan(-1.0);
    });
  });
});
