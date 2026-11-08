import {
  analyzeFrequencyBands,
  createSpectrumAnalyzer,
  disposeSpectrumAnalyzer,
  getFrequencyProfile,
} from "@/lib/noise/spectrumAnalyzer";

describe("Spectrum Analyzer AudioNode Lifecycle and Teardown Safety", () => {
  let mockDisconnectAnalyser: jest.Mock;
  let mockDisconnectSource: jest.Mock;
  let mockConnectSource: jest.Mock;
  let mockGetFloatFrequencyData: jest.Mock;
  let mockAudioContext: any;
  let mockSourceNode: any;
  let mockAnalyserNode: any;

  beforeEach(() => {
    mockDisconnectAnalyser = jest.fn();
    mockDisconnectSource = jest.fn();
    mockConnectSource = jest.fn();
    mockGetFloatFrequencyData = jest.fn((buffer: Float32Array) => {
      buffer.fill(-70); // Fill with baseline ambient noise
    });

    mockAnalyserNode = {
      fftSize: 512,
      frequencyBinCount: 256,
      smoothingTimeConstant: 0.8,
      minDecibels: -100,
      maxDecibels: -30,
      connect: jest.fn(),
      disconnect: mockDisconnectAnalyser,
      getFloatFrequencyData: mockGetFloatFrequencyData,
    };

    mockSourceNode = {
      connect: mockConnectSource,
      disconnect: mockDisconnectSource,
    };

    mockAudioContext = {
      sampleRate: 48000,
      state: "running",
      createAnalyser: jest.fn(() => mockAnalyserNode),
    };
  });

  it("creates and connects analyzer node graph with configured parameters", () => {
    const instance = createSpectrumAnalyzer(mockAudioContext, mockSourceNode, {
      fftSize: 1024,
      smoothingTimeConstant: 0.5,
    });

    expect(mockAudioContext.createAnalyser).toHaveBeenCalledTimes(1);
    expect(mockAnalyserNode.fftSize).toBe(1024);
    expect(mockAnalyserNode.smoothingTimeConstant).toBe(0.5);
    expect(mockConnectSource).toHaveBeenCalledWith(mockAnalyserNode);
    expect(instance.fftSize).toBe(1024);
    expect(instance.sampleRate).toBe(48000);
  });

  it("cleans up nodes and buffers on dispose() during rapid mount/unmount", () => {
    const instance = createSpectrumAnalyzer(mockAudioContext, mockSourceNode);

    // Call spectrum analysis
    const spectrumBefore = instance.getFrequencySpectrum();
    expect(spectrumBefore.profileTag).toBeDefined();

    // Trigger teardown
    instance.dispose();

    expect(mockDisconnectSource).toHaveBeenCalledWith(mockAnalyserNode);
    expect(mockDisconnectAnalyser).toHaveBeenCalledTimes(1);

    // Post-dispose invocations return safe fallback without throwing
    const spectrumAfter = instance.getFrequencySpectrum();
    expect(spectrumAfter.profileTag).toBe("Balanced Ambience");
    expect(spectrumAfter.lowEnergy).toBe(0);
    expect(spectrumAfter.midEnergy).toBe(0);
    expect(spectrumAfter.highEnergy).toBe(0);
  });

  it("gracefully handles standalone disposeSpectrumAnalyzer without throwing when nodes are undefined or already disconnected", () => {
    expect(() => disposeSpectrumAnalyzer(null, null)).not.toThrow();
    expect(() => disposeSpectrumAnalyzer(undefined, undefined)).not.toThrow();

    const throwingSource = {
      disconnect: jest.fn(() => {
        throw new Error("InvalidStateError: node is already disconnected");
      }),
    };
    const throwingAnalyser = {
      disconnect: jest.fn(() => {
        throw new Error("InvalidAccessError");
      }),
    };

    expect(() =>
      disposeSpectrumAnalyzer(throwingAnalyser as any, throwingSource as any),
    ).not.toThrow();
  });

  it("produces zero NaN values for completely silent, zero, or negative infinity audio frames", () => {
    const silentBins = new Float32Array(256).fill(-Infinity);
    const spectrumSilent = analyzeFrequencyBands(silentBins, 48000, 512);

    expect(Number.isNaN(spectrumSilent.lowPercentage)).toBe(false);
    expect(Number.isNaN(spectrumSilent.midPercentage)).toBe(false);
    expect(Number.isNaN(spectrumSilent.highPercentage)).toBe(false);
    expect(Number.isNaN(spectrumSilent.lowEnergy)).toBe(false);
    expect(Number.isNaN(spectrumSilent.midEnergy)).toBe(false);
    expect(Number.isNaN(spectrumSilent.highEnergy)).toBe(false);

    expect(spectrumSilent.lowPercentage + spectrumSilent.midPercentage + spectrumSilent.highPercentage).toBeCloseTo(100, 0);

    const zeroBins = new Float32Array(256).fill(0);
    const spectrumZero = analyzeFrequencyBands(zeroBins, 48000, 512);
    expect(Number.isNaN(spectrumZero.lowPercentage)).toBe(false);
  });

  it("accurately classifies acoustic profiles across frequency thresholds", () => {
    expect(getFrequencyProfile(60, 20, 20).tag).toBe("Heavy HVAC Rumble");
    expect(getFrequencyProfile(15, 70, 15).tag).toBe("Chatter Heavy");
    expect(getFrequencyProfile(10, 20, 70).tag).toBe("High Clatter & Hiss");
    expect(getFrequencyProfile(33.3, 33.3, 33.4).tag).toBe("Balanced Ambience");
  });
});
