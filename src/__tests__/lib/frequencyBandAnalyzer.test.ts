import {
  LOW_BAND_MIN_HZ,
  LOW_BAND_MAX_HZ,
  MID_BAND_MIN_HZ,
  MID_BAND_MAX_HZ,
  HIGH_BAND_MIN_HZ,
  HIGH_BAND_MAX_HZ,
  analyzeFrequencyBands,
  getFrequencyProfile,
  analyzeTimeDomainBands,
} from "@/lib/noise/spectrumAnalyzer";

describe("Frequency Band Spectrum Analyzer", () => {
  describe("Frequency Band Constants", () => {
    it("defines correct psychoacoustic frequency boundaries", () => {
      expect(LOW_BAND_MIN_HZ).toBe(20);
      expect(LOW_BAND_MAX_HZ).toBe(250);
      expect(MID_BAND_MIN_HZ).toBe(250);
      expect(MID_BAND_MAX_HZ).toBe(4000);
      expect(HIGH_BAND_MIN_HZ).toBe(4000);
      expect(HIGH_BAND_MAX_HZ).toBe(20000);
    });
  });

  describe("getFrequencyProfile", () => {
    it("classifies Heavy HVAC Rumble when low band energy is dominant", () => {
      const profile = getFrequencyProfile(60, 25, 15);
      expect(profile.dominantBand).toBe("low");
      expect(profile.tag).toBe("Heavy HVAC Rumble");
      expect(profile.badgeColor).toContain("purple");
    });

    it("classifies Chatter Heavy when mid band speech frequencies dominate", () => {
      const profile = getFrequencyProfile(20, 65, 15);
      expect(profile.dominantBand).toBe("mid");
      expect(profile.tag).toBe("Chatter Heavy");
      expect(profile.badgeColor).toContain("amber");
    });

    it("classifies High Clatter & Hiss when treble frequencies dominate", () => {
      const profile = getFrequencyProfile(25, 30, 45);
      expect(profile.dominantBand).toBe("high");
      expect(profile.tag).toBe("High Clatter & Hiss");
      expect(profile.badgeColor).toContain("cyan");
    });

    it("classifies Balanced Ambience when frequency distribution is balanced", () => {
      const profile = getFrequencyProfile(34, 33, 33);
      expect(profile.dominantBand).toBe("balanced");
      expect(profile.tag).toBe("Balanced Ambience");
      expect(profile.badgeColor).toContain("emerald");
    });
  });

  describe("analyzeFrequencyBands", () => {
    it("handles empty frequency bins safely with balanced defaults", () => {
      const spectrum = analyzeFrequencyBands([], 48000, 512);
      expect(spectrum.lowPercentage).toBe(33.3);
      expect(spectrum.midPercentage).toBe(33.3);
      expect(spectrum.highPercentage).toBe(33.4);
      expect(spectrum.dominantBand).toBe("balanced");
    });

    it("segregates float dBFS bins into correct frequency bands", () => {
      // 512 FFT bins at 48000 Hz => ~93.75 Hz per bin
      // Bin 0: 0 Hz
      // Bin 1: 93.75 Hz (Low band: 20-250 Hz)
      // Bin 2: 187.5 Hz (Low band)
      // Bin 10: 937.5 Hz (Mid band: 250-4000 Hz)
      // & Bin 100: 9375 Hz (High band: 4000-20000 Hz)
      const bins = new Float32Array(256).fill(-100);
      bins[1] = -10; // Low band spike (93.75 Hz)
      bins[2] = -15; // Low band spike (187.5 Hz)

      const spectrum = analyzeFrequencyBands(bins, 48000, 512);
      expect(spectrum.lowPercentage).toBeGreaterThan(80);
      expect(spectrum.dominantBand).toBe("low");
      expect(spectrum.profileTag).toBe("Heavy HVAC Rumble");
    });

    it("correctly identifies speech midrange chatter dominance", () => {
      const bins = new Float32Array(256).fill(-100);
      // Mid band bins: 250 Hz to 4000 Hz => bin indices ~ 3 to 42
      for (let i = 5; i <= 20; i++) {
        bins[i] = -15;
      }

      const spectrum = analyzeFrequencyBands(bins, 48000, 512);
      expect(spectrum.midPercentage).toBeGreaterThan(60);
      expect(spectrum.dominantBand).toBe("mid");
      expect(spectrum.profileTag).toBe("Chatter Heavy");
    });

    it("works with Uint8Array byte frequency data from Web Audio", () => {
      const byteBins = new Uint8Array(256).fill(10);
      // Put strong signal in high frequencies (bins 50..100)
      for (let i = 50; i <= 100; i++) {
        byteBins[i] = 240;
      }

      const spectrum = analyzeFrequencyBands(byteBins, 48000, 512);
      expect(spectrum.highPercentage).toBeGreaterThan(50);
      expect(spectrum.dominantBand).toBe("high");
      expect(spectrum.profileTag).toBe("High Clatter & Hiss");
    });
  });

  describe("analyzeTimeDomainBands", () => {
    it("handles empty time domain buffer", () => {
      const spectrum = analyzeTimeDomainBands([]);
      expect(spectrum.dominantBand).toBe("balanced");
    });

    it("accurately detects a low-frequency 100Hz bass sine wave", () => {
      const sampleRate = 48000;
      const length = 1024;
      const buffer = new Float32Array(length);
      const freq = 100; // Bass / HVAC rumble frequency

      for (let i = 0; i < length; i++) {
        buffer[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
      }

      const spectrum = analyzeTimeDomainBands(buffer, sampleRate);
      expect(spectrum.dominantBand).toBe("low");
      expect(spectrum.lowPercentage).toBeGreaterThan(60);
      expect(spectrum.profileTag).toBe("Heavy HVAC Rumble");
    });

    it("accurately detects a 1000Hz speech midrange sine wave", () => {
      const sampleRate = 48000;
      const length = 1024;
      const buffer = new Float32Array(length);
      const freq = 1000; // Mid-frequency speech tone

      for (let i = 0; i < length; i++) {
        buffer[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
      }

      const spectrum = analyzeTimeDomainBands(buffer, sampleRate);
      expect(spectrum.dominantBand).toBe("mid");
      expect(spectrum.midPercentage).toBeGreaterThan(60);
      expect(spectrum.profileTag).toBe("Chatter Heavy");
    });

    it("accurately detects an 8000Hz treble / steam hiss sine wave", () => {
      const sampleRate = 48000;
      const length = 1024;
      const buffer = new Float32Array(length);
      const freq = 8000; // Treble clatter / hiss

      for (let i = 0; i < length; i++) {
        buffer[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
      }

      const spectrum = analyzeTimeDomainBands(buffer, sampleRate);
      expect(spectrum.dominantBand).toBe("high");
      expect(spectrum.highPercentage).toBeGreaterThan(60);
      expect(spectrum.profileTag).toBe("High Clatter & Hiss");
    });
  });
});
