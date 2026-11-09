import {
  safeResumeAudioContext,
  analyzeFrequencyBands,
  analyzeTimeDomainBands,
  getFrequencyProfile,
  AudioContextAutoplayState,
  LOW_BAND_MIN_HZ,
  LOW_BAND_MAX_HZ,
  MID_BAND_MIN_HZ,
  MID_BAND_MAX_HZ,
  HIGH_BAND_MIN_HZ,
  HIGH_BAND_MAX_HZ,
} from "../../lib/noise/spectrumAnalyzer";

describe("spectrumAnalyzer - safeResumeAudioContext & Autoplay Policy Handling (#4374)", () => {
  let mockAudioContext: Partial<AudioContext>;

  beforeEach(() => {
    mockAudioContext = {
      state: "suspended",
      resume: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe("safeResumeAudioContext basic behavior", () => {
    test("returns unknown state and error when AudioContext is undefined or null", async () => {
      const result = await safeResumeAudioContext(null as unknown as AudioContext);
      expect(result).toEqual({
        isBlockedByAutoplay: false,
        state: "unknown",
        error: expect.any(Error),
      });
      expect(result.error?.message).toBe("AudioContext is undefined");
    });

    test("returns running status immediately if AudioContext state is already running", async () => {
      const runningContext = {
        state: "running" as AudioContextState,
        resume: jest.fn(),
      } as unknown as AudioContext;

      const result = await safeResumeAudioContext(runningContext);
      expect(result).toEqual({
        isBlockedByAutoplay: false,
        state: "running",
        error: null,
      });
      expect(runningContext.resume).not.toHaveBeenCalled();
    });

    test("successfully resumes suspended AudioContext and returns unblocked state", async () => {
      const resumeMock = jest.fn().mockImplementation(async () => {
        (mockAudioContext as AudioContext).state = "running";
      });
      mockAudioContext.resume = resumeMock;

      const result = await safeResumeAudioContext(mockAudioContext as AudioContext);
      expect(resumeMock).toHaveBeenCalledTimes(1);
      expect(result.isBlockedByAutoplay).toBe(false);
      expect(result.state).toBe("running");
      expect(result.error).toBeNull();
    });

    test("handles AudioContext remaining in suspended state after resume without error", async () => {
      mockAudioContext.state = "suspended";
      mockAudioContext.resume = jest.fn().mockResolvedValue(undefined);

      const result = await safeResumeAudioContext(mockAudioContext as AudioContext);
      expect(result.isBlockedByAutoplay).toBe(true);
      expect(result.state).toBe("suspended");
      expect(result.error).toBeNull();
    });

    test("gracefully catches rejected promise from resume() when autoplay is blocked by browser policy", async () => {
      const autoplayError = new DOMException(
        "The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page.",
        "NotAllowedError"
      );
      mockAudioContext.state = "suspended";
      mockAudioContext.resume = jest.fn().mockRejectedValue(autoplayError);

      const result = await safeResumeAudioContext(mockAudioContext as AudioContext);

      expect(result.isBlockedByAutoplay).toBe(true);
      expect(result.state).toBe("suspended");
      expect(result.error).toBe(autoplayError);
      expect(result.error?.name).toBe("NotAllowedError");
    });

    test("gracefully handles string rejection errors from resume()", async () => {
      mockAudioContext.state = "suspended";
      mockAudioContext.resume = jest.fn().mockRejectedValue("Autoplay policy restriction");

      const result = await safeResumeAudioContext(mockAudioContext as AudioContext);

      expect(result.isBlockedByAutoplay).toBe(true);
      expect(result.state).toBe("suspended");
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("Autoplay policy restriction");
    });

    test("gracefully handles synchronous errors thrown inside resume()", async () => {
      mockAudioContext.state = "suspended";
      mockAudioContext.resume = jest.fn().mockImplementation(() => {
        throw new Error("Synchronous AudioContext resume failure");
      });

      const result = await safeResumeAudioContext(mockAudioContext as AudioContext);

      expect(result.isBlockedByAutoplay).toBe(true);
      expect(result.state).toBe("suspended");
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("Synchronous AudioContext resume failure");
    });
  });

  describe("Browser Environment Autoplay Edge Cases", () => {
    test("simulates Safari autoplay restriction (NotAllowedError)", async () => {
      const safariError = new Error("User gesture is required to estimate audio spectrum");
      safariError.name = "NotAllowedError";

      const ctx = {
        state: "suspended" as AudioContextState,
        resume: jest.fn().mockRejectedValue(safariError),
      } as unknown as AudioContext;

      const status = await safeResumeAudioContext(ctx);
      expect(status.isBlockedByAutoplay).toBe(true);
      expect(status.error?.name).toBe("NotAllowedError");
    });

    test("simulates Chrome autoplay policy with blocked user gesture", async () => {
      const chromeError = new Error("play() failed because the user didn't interact with the document first.");
      chromeError.name = "NotAllowedError";

      const ctx = {
        state: "suspended" as AudioContextState,
        resume: jest.fn().mockRejectedValue(chromeError),
      } as unknown as AudioContext;

      const status = await safeResumeAudioContext(ctx);
      expect(status.isBlockedByAutoplay).toBe(true);
      expect(status.error?.message).toContain("user didn't interact");
    });

    test("simulates closed AudioContext state return", async () => {
      const closedContext = {
        state: "closed" as AudioContextState,
        resume: jest.fn().mockRejectedValue(new Error("Cannot resume closed AudioContext")),
      } as unknown as AudioContext;

      const result = await safeResumeAudioContext(closedContext);
      expect(result.isBlockedByAutoplay).toBe(true);
      expect(result.state).toBe("closed");
      expect(result.error).not.toBeNull();
    });

    test("resumes after simulated user interaction retry", async () => {
      let userInteracted = false;
      const interactiveContext = {
        state: "suspended" as AudioContextState,
        resume: jest.fn().mockImplementation(async () => {
          if (!userInteracted) {
            throw new Error("Autoplay blocked");
          }
          interactiveContext.state = "running";
        }),
      } as unknown as AudioContext;

      // Attempt 1: Before gesture
      let res = await safeResumeAudioContext(interactiveContext);
      expect(res.isBlockedByAutoplay).toBe(true);
      expect(res.state).toBe("suspended");

      // User clicks "Enable Microphone" button
      userInteracted = true;

      // Attempt 2: After gesture
      res = await safeResumeAudioContext(interactiveContext);
      expect(res.isBlockedByAutoplay).toBe(false);
      expect(res.state).toBe("running");
      expect(res.error).toBeNull();
    });
  });

  describe("Frequency Profile Classification", () => {
    test("classifies low frequency dominant noise (Heavy HVAC Rumble)", () => {
      const profile = getFrequencyProfile(50, 30, 20);
      expect(profile.dominantBand).toBe("low");
      expect(profile.tag).toBe("Heavy HVAC Rumble");
      expect(profile.badgeColor).toContain("purple");
    });

    test("classifies mid frequency dominant noise (Chatter Heavy)", () => {
      const profile = getFrequencyProfile(20, 60, 20);
      expect(profile.dominantBand).toBe("mid");
      expect(profile.tag).toBe("Chatter Heavy");
      expect(profile.badgeColor).toContain("amber");
    });

    test("classifies high frequency dominant noise (High Clatter & Hiss)", () => {
      const profile = getFrequencyProfile(20, 35, 45);
      expect(profile.dominantBand).toBe("high");
      expect(profile.tag).toBe("High Clatter & Hiss");
      expect(profile.badgeColor).toContain("cyan");
    });

    test("classifies balanced frequency distribution (Balanced Ambience)", () => {
      const profile = getFrequencyProfile(33.3, 33.3, 33.4);
      expect(profile.dominantBand).toBe("balanced");
      expect(profile.tag).toBe("Balanced Ambience");
      expect(profile.badgeColor).toContain("emerald");
    });
  });

  describe("Frequency Spectrum Analysis", () => {
    test("handles empty frequency bin array", () => {
      const spectrum = analyzeFrequencyBands([]);
      expect(spectrum.dominantBand).toBe("balanced");
      expect(spectrum.lowEnergy).toBe(0);
      expect(spectrum.midEnergy).toBe(0);
      expect(spectrum.highEnergy).toBe(0);
    });

    test("analyzes Float32Array frequency bins (dBFS values)", () => {
      const bins = new Float32Array(256);
      // Fill low band with strong signal (-10 dBFS) and others with silence (-100 dBFS)
      for (let i = 0; i < 10; i++) bins[i] = -10;
      for (let i = 10; i < 256; i++) bins[i] = -100;

      const spectrum = analyzeFrequencyBands(bins, 48000, 512);
      expect(spectrum.lowPercentage).toBeGreaterThan(spectrum.midPercentage);
      expect(spectrum.lowPercentage).toBeGreaterThan(spectrum.highPercentage);
    });

    test("analyzes Uint8Array byte frequency bins", () => {
      const bins = new Uint8Array(256);
      // Fill mid band bins with high amplitude (200)
      const midBinStart = Math.floor((MID_BAND_MIN_HZ / 48000) * 512);
      const midBinEnd = Math.floor((MID_BAND_MAX_HZ / 48000) * 512);
      for (let i = midBinStart; i < midBinEnd && i < 256; i++) {
        bins[i] = 200;
      }

      const spectrum = analyzeFrequencyBands(bins, 48000, 512);
      expect(spectrum.midPercentage).toBeGreaterThan(50);
      expect(spectrum.dominantBand).toBe("mid");
    });

    test("handles zero energy bins array gracefully", () => {
      const bins = new Float32Array(256).fill(-150);
      const spectrum = analyzeFrequencyBands(bins);
      expect(spectrum.dominantBand).toBe("balanced");
      expect(spectrum.lowPercentage).toBe(33.3);
      expect(spectrum.midPercentage).toBe(33.3);
      expect(spectrum.highPercentage).toBe(33.4);
    });
  });

  describe("Time Domain Spectrum Analysis", () => {
    test("analyzes time domain PCM samples for sine waves", () => {
      const sampleRate = 48000;
      const numSamples = 1024;
      const samples = new Float32Array(numSamples);

      // Generate 100Hz sine wave (Low Band)
      for (let i = 0; i < numSamples; i++) {
        samples[i] = Math.sin((2 * Math.PI * 100 * i) / sampleRate);
      }

      const spectrum = analyzeTimeDomainBands(samples, sampleRate);
      expect(spectrum.lowPercentage).toBeGreaterThan(spectrum.midPercentage);
      expect(spectrum.dominantBand).toBe("low");
    });

    test("returns balanced default for empty PCM sample buffer", () => {
      const spectrum = analyzeTimeDomainBands([], 48000);
      expect(spectrum.dominantBand).toBe("balanced");
      expect(spectrum.lowEnergy).toBe(0);
    });
  });

  describe("Constants Verification", () => {
    test("verifies frequency band limits", () => {
      expect(LOW_BAND_MIN_HZ).toBe(20);
      expect(LOW_BAND_MAX_HZ).toBe(250);
      expect(MID_BAND_MIN_HZ).toBe(250);
      expect(MID_BAND_MAX_HZ).toBe(4000);
      expect(HIGH_BAND_MIN_HZ).toBe(4000);
      expect(HIGH_BAND_MAX_HZ).toBe(20000);
    });
  });
});
