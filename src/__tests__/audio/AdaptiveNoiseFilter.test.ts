import { AdaptiveNoiseFilter } from "@/lib/audio/AdaptiveNoiseFilter";

type MockAudioContext = AudioContext & {
  gainNodes: any[];
  filterNodes: any[];
  setSampleRate: (sampleRate: number) => void;
  setState: (state: AudioContextState) => void;
};

function createMockAudioContext(
  initialState: AudioContextState = "running",
): MockAudioContext {
  let state = initialState;
  let sampleRate = 48000;
  const stateListeners = new Set<() => void>();
  const gainNodes: any[] = [];
  const filterNodes: any[] = [];

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

  const createMockGain = () => {
    const node = {
      ...createMockAudioNode(),
      gain: createMockAudioParam(1),
    };
    gainNodes.push(node);
    return node;
  };

  const createMockFilter = () => {
    const node = {
      ...createMockAudioNode(),
      type: "lowpass",
      frequency: createMockAudioParam(350),
      Q: createMockAudioParam(1),
      gain: createMockAudioParam(0),
    };
    filterNodes.push(node);
    return node;
  };

  return {
    currentTime: 0,
    get sampleRate() {
      return sampleRate;
    },
    setSampleRate(nextSampleRate: number) {
      sampleRate = nextSampleRate;
    },
    get state() {
      return state;
    },
    setState(nextState: AudioContextState) {
      state = nextState;
      stateListeners.forEach((listener) => listener());
    },
    addEventListener: jest.fn(
      (type: string, listener: () => void) => {
        if (type === "statechange") stateListeners.add(listener);
      },
    ),
    removeEventListener: jest.fn(
      (type: string, listener: () => void) => {
        if (type === "statechange") stateListeners.delete(listener);
      },
    ),
    gainNodes,
    filterNodes,
    createGain: jest.fn(createMockGain),
    createBiquadFilter: jest.fn(createMockFilter),
    createAnalyser: jest.fn(() => ({
      ...createMockAudioNode(),
      fftSize: 1024,
      frequencyBinCount: 512,
      smoothingTimeConstant: 0.8,
      getFloatTimeDomainData: jest.fn(),
      getByteFrequencyData: jest.fn(),
    })),
  } as unknown as MockAudioContext;
}

describe("AdaptiveNoiseFilter (Dynamic Ambient Noise Cancellation)", () => {
  let mockContext: MockAudioContext;

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
    expect(filter.getIsBypassed()).toBe(false);

    // Highpass connects to the first notch
    expect(filter.highpassFilter.connect).toHaveBeenCalled();
  });

  it("recreates every biquad filter and reapplies coefficients after a sample-rate change", () => {
    const filter = new AdaptiveNoiseFilter(mockContext, {
      highPassCutoff: 150,
      notchFrequencies: [60, 120, 2400],
    });
    const previousFilters = [
      filter.highpassFilter,
      ...filter.notchFilters,
      filter.dynamicNotchFilter,
    ];
    const originalFilterCount = mockContext.filterNodes.length;

    mockContext.setSampleRate(44100);
    filter.processSample();

    const replacementFilters = [
      filter.highpassFilter,
      ...filter.notchFilters,
      filter.dynamicNotchFilter,
    ];
    const newlyCreatedFilters = mockContext.filterNodes.slice(originalFilterCount);

    expect(newlyCreatedFilters).toHaveLength(previousFilters.length);
    previousFilters.forEach((previous, index) => {
      expect(previous.disconnect).toHaveBeenCalled();
      expect(replacementFilters[index]).not.toBe(previous);
    });
    replacementFilters.forEach((replacement) => {
      expect(replacement.frequency.setValueAtTime).toHaveBeenCalled();
      expect(replacement.Q.setValueAtTime).toHaveBeenCalled();
    });
    expect(filter.highpassFilter.frequency.setValueAtTime).toHaveBeenCalledWith(
      150,
      mockContext.currentTime,
    );
    filter.notchFilters.forEach((notch, index) => {
      expect(notch.frequency.setValueAtTime).toHaveBeenCalledWith(
        [60, 120, 2400][index],
        mockContext.currentTime,
      );
    });
    expect(
      filter.dynamicNotchFilter.frequency.setValueAtTime,
    ).toHaveBeenCalledWith(2800, mockContext.currentTime);
  });

  it("preserves filter nodes and state between blocks when the sample rate is unchanged", () => {
    const filter = new AdaptiveNoiseFilter(mockContext);
    const filters = [
      filter.highpassFilter,
      ...filter.notchFilters,
      filter.dynamicNotchFilter,
    ];
    const parameterCallCounts = filters.map(
      (node) =>
        (node.frequency.setValueAtTime as jest.Mock).mock.calls.length,
    );
    const createdFilterCount = mockContext.filterNodes.length;

    filter.processSample();

    expect(
      [
        filter.highpassFilter,
        ...filter.notchFilters,
        filter.dynamicNotchFilter,
      ],
    ).toEqual(filters);
    expect(mockContext.filterNodes).toHaveLength(createdFilterCount);
    expect(
      filters.map(
        (node) =>
          (node.frequency.setValueAtTime as jest.Mock).mock.calls.length,
      ),
    ).toEqual(parameterCallCounts);
  });

  it("resets all biquad state again for each repeated sample-rate change", () => {
    const filter = new AdaptiveNoiseFilter(mockContext, {
      notchFrequencies: [60, 120],
    });
    const initialFilters = [
      filter.highpassFilter,
      ...filter.notchFilters,
      filter.dynamicNotchFilter,
    ];

    mockContext.setSampleRate(44100);
    filter.processSample();
    const secondRateFilters = [
      filter.highpassFilter,
      ...filter.notchFilters,
      filter.dynamicNotchFilter,
    ];

    mockContext.setSampleRate(32000);
    filter.processSample();
    const thirdRateFilters = [
      filter.highpassFilter,
      ...filter.notchFilters,
      filter.dynamicNotchFilter,
    ];

    expect(mockContext.filterNodes).toHaveLength(initialFilters.length * 3);
    initialFilters.forEach((node, index) => {
      expect(node.disconnect).toHaveBeenCalled();
      expect(secondRateFilters[index]).not.toBe(node);
    });
    secondRateFilters.forEach((node, index) => {
      expect(node.disconnect).toHaveBeenCalled();
      expect(thirdRateFilters[index]).not.toBe(node);
    });
    thirdRateFilters.forEach((node) => {
      expect(node.frequency.setValueAtTime).toHaveBeenCalled();
      expect(node.Q.setValueAtTime).toHaveBeenCalled();
    });
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
    expect(filter.getIsBypassed()).toBe(true);

    filter.setEnabled(true);
    expect(filter.getIsEnabled()).toBe(true);
    expect(filter.getIsBypassed()).toBe(false);
  });

  it("avoids audio parameter updates while suspended and restores filtering on resume", () => {
    const suspendedContext = createMockAudioContext("suspended");
    const filter = new AdaptiveNoiseFilter(suspendedContext, {
      highPassCutoff: 180,
      notchFrequencies: [60],
    });

    expect(filter.getIsBypassed()).toBe(true);
    suspendedContext.filterNodes.forEach((node) => {
      expect(node.frequency.setValueAtTime).not.toHaveBeenCalled();
      expect(node.Q.setValueAtTime).not.toHaveBeenCalled();
      expect(node.connect).not.toHaveBeenCalled();
    });
    suspendedContext.gainNodes.forEach((node) => {
      expect(node.gain.setValueAtTime).not.toHaveBeenCalled();
      expect(node.connect).not.toHaveBeenCalled();
    });
    filter.processSample();
    filter.tuneDynamicNotch(1200);
    expect(filter.analyserNode.getFloatTimeDomainData).not.toHaveBeenCalled();

    suspendedContext.setState("running");

    expect(filter.getIsBypassed()).toBe(false);
    expect(filter.highpassFilter.frequency.setValueAtTime).toHaveBeenCalledWith(
      180,
      suspendedContext.currentTime,
    );
    expect(filter.notchFilters[0]?.frequency.setValueAtTime).toHaveBeenCalledWith(
      60,
      suspendedContext.currentTime,
    );
    expect(suspendedContext.gainNodes[0].connect).toHaveBeenCalledTimes(3);
  });

  it("handles repeated suspend/resume transitions without duplicate connections", () => {
    const filter = new AdaptiveNoiseFilter(mockContext);
    filter.tuneDynamicNotch(850);
    const initialConnections = mockContext.gainNodes.map(
      (node) => node.connect.mock.calls.length,
    );
    const initialFrequencyUpdates =
      filter.dynamicNotchFilter.frequency.setValueAtTime.mock.calls.length;
    expect(mockContext.addEventListener).toHaveBeenCalledTimes(1);

    mockContext.setState("suspended");
    filter.tuneDynamicNotch(900);
    filter.setEnabled(false);
    expect(filter.getIsBypassed()).toBe(true);
    expect(
      filter.dynamicNotchFilter.frequency.setTargetAtTime,
    ).toHaveBeenCalledTimes(1);

    mockContext.setState("running");
    expect(filter.getIsBypassed()).toBe(true);
    expect(filter.dynamicNotchFilter.frequency.setValueAtTime).toHaveBeenCalledTimes(
      initialFrequencyUpdates + 1,
    );
    expect(
      filter.dynamicNotchFilter.frequency.setValueAtTime,
    ).toHaveBeenLastCalledWith(850, mockContext.currentTime);

    filter.setEnabled(true);
    mockContext.setState("suspended");
    mockContext.setState("running");
    expect(filter.getIsBypassed()).toBe(false);
    expect(
      mockContext.gainNodes.map((node) => node.connect.mock.calls.length),
    ).toEqual(initialConnections);
    expect(mockContext.addEventListener).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or initially closed contexts and safely ignores a context that closes later", () => {
    expect(() => new AdaptiveNoiseFilter(null)).toThrow(
      "AdaptiveNoiseFilter requires an AudioContext",
    );

    const closedContext = createMockAudioContext("closed");
    expect(() => new AdaptiveNoiseFilter(closedContext)).toThrow(
      "AdaptiveNoiseFilter cannot use a closed AudioContext",
    );
    expect(closedContext.createGain).not.toHaveBeenCalled();

    const context = createMockAudioContext();
    const filter = new AdaptiveNoiseFilter(context);
    const gainUpdateCount =
      context.gainNodes[2].gain.setValueAtTime.mock.calls.length;
    context.setState("closed");

    filter.setEnabled(false);
    filter.tuneDynamicNotch(1000);
    expect(filter.processSample().dominantNoiseFrequency).toBeNull();
    expect(context.gainNodes[2].gain.setValueAtTime).toHaveBeenCalledTimes(
      gainUpdateCount,
    );
    expect(() => filter.dispose()).not.toThrow();
  });

  it("disconnects all nodes on dispose", () => {
    const filter = new AdaptiveNoiseFilter(mockContext);
    expect(() => filter.dispose()).not.toThrow();
    expect(filter.inputNode.disconnect).toHaveBeenCalled();
    expect(filter.highpassFilter.disconnect).toHaveBeenCalled();
    expect(mockContext.removeEventListener).toHaveBeenCalledTimes(1);
    expect(() => mockContext.setState("suspended")).not.toThrow();
    filter.dispose();
    expect(mockContext.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
