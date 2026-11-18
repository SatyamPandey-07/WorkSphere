import { AdaptiveNoiseFilter } from "@/lib/audio/AdaptiveNoiseFilter";

function createMockAudioContext(): AudioContext {
  const createMockAudioParam = (initialValue: number = 0) => ({
    value: initialValue,
    setValueAtTime: jest.fn(),
    setTargetAtTime: jest.fn(),
    linearRampToValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn(),
  });

  const createMockAudioNode = () => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
  });

  return {
    currentTime: 0,
    sampleRate: 48000,
    createGain: jest.fn(() => ({
      ...createMockAudioNode(),
      gain: createMockAudioParam(1),
    })),
    createBiquadFilter: jest.fn(() => ({
      ...createMockAudioNode(),
      type: "lowpass",
      frequency: createMockAudioParam(350),
      Q: createMockAudioParam(1),
      gain: createMockAudioParam(0),
    })),
    createAnalyser: jest.fn(() => ({
      ...createMockAudioNode(),
      fftSize: 1024,
      frequencyBinCount: 512,
      smoothingTimeConstant: 0.8,
      getFloatTimeDomainData: jest.fn(),
      getByteFrequencyData: jest.fn(),
    })),
  } as unknown as AudioContext;
}

describe("AdaptiveNoiseFilter (Dynamic Ambient Noise Cancellation)", () => {
  let mockContext: AudioContext;

  beforeEach(() => {
    mockContext = createMockAudioContext();
  });

  it("chains high-pass and notch BiquadFilterNode instances", () => {
    const filter = new AdaptiveNoiseFilter(mockContext, {
      highPassCutoff: 150,
      notchFrequencies: [60, 120, 2400],
    });

    expect(filter.highpassFilter.type).toBe("highpass");
    expect(filter.highpassFilter.frequency.setValueAtTime).toHaveBeenCalledWith(
      150,
      0,
    );

    // 3 static notches + 1 dynamic tracking notch = 4 notch filters created
    expect(filter.notchFilters).toHaveLength(3);
    expect(filter.dynamicNotchFilter.type).toBe("notch");

    // Highpass connects to the first notch
    expect(filter.highpassFilter.connect).toHaveBeenCalled();
  });

  it("provides speech detection threshold gate and detects speech", () => {
    const filter = new AdaptiveNoiseFilter(mockContext, {
      speechThresholdDb: -40,
    });

    // Mock speech audio signal (RMS level approx -20 dB)
    (filter.analyserNode.getFloatTimeDomainData as jest.Mock).mockImplementation(
      (buffer: Float32Array) => {
        buffer.fill(0.1); // 20 * log10(0.1) = -20 dB (> -40 dB threshold)
      },
    );

    const result = filter.processSample();

    expect(result.isSpeech).toBe(true);
    expect(result.currentLevelDb).toBeGreaterThan(-40);
    expect(filter.gateNode.gain.setTargetAtTime).toHaveBeenCalledWith(
      1.0, // Open gate for speech
      0,
      expect.any(Number),
    );
  });

  it("samples ambient room noise during silence and tunes dynamic notch", () => {
    const filter = new AdaptiveNoiseFilter(mockContext, {
      speechThresholdDb: -40,
    });

    // Mock ambient silence (RMS level approx -60 dB)
    (filter.analyserNode.getFloatTimeDomainData as jest.Mock).mockImplementation(
      (buffer: Float32Array) => {
        buffer.fill(0.001); // 20 * log10(0.001) = -60 dB (below threshold)
      },
    );

    // Mock a loud 2.4kHz coffee machine whine peak in frequency spectrum
    (filter.analyserNode.getByteFrequencyData as jest.Mock).mockImplementation(
      (buffer: Uint8Array) => {
        buffer.fill(10);
        // Peak at bin index corresponding to ~2400Hz (sampleRate: 48000, nyquist: 24000)
        // bin index = (2400 / 24000) * 512 = ~51
        buffer[51] = 220;
      },
    );

    const result = filter.processSample();

    expect(result.isSpeech).toBe(false);
    expect(result.currentLevelDb).toBeLessThan(-40);
    expect(filter.gateNode.gain.setTargetAtTime).toHaveBeenCalledWith(
      0.15, // Clamped gate attenuation during silence
      0,
      expect.any(Number),
    );

    expect(result.dominantNoiseFrequency).toBeCloseTo(2391, -2);
    expect(filter.dynamicNotchFilter.frequency.setTargetAtTime).toHaveBeenCalled();
  });

  it("allows toggling filter bypass via setEnabled", () => {
    const filter = new AdaptiveNoiseFilter(mockContext);
    expect(filter.getIsEnabled()).toBe(true);

    filter.setEnabled(false);
    expect(filter.getIsEnabled()).toBe(false);

    filter.setEnabled(true);
    expect(filter.getIsEnabled()).toBe(true);
  });

  it("disconnects all nodes on dispose", () => {
    const filter = new AdaptiveNoiseFilter(mockContext);
    expect(() => filter.dispose()).not.toThrow();
    expect(filter.inputNode.disconnect).toHaveBeenCalled();
    expect(filter.highpassFilter.disconnect).toHaveBeenCalled();
  });
});
