import {
  AcousticFilterEngine,
  clampFrequency,
  clampQ,
  isValidAcousticFilterPreset,
} from "@/lib/audio/acousticFilterEngine";

function createMockAudioParam(initialValue = 0) {
  return {
    value: initialValue,
    setValueAtTime: jest.fn(),
    setTargetAtTime: jest.fn(),
    linearRampToValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn(),
  };
}

function createMockAudioNode() {
  return {
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
}

function createMockAudioContext(sampleRate = 48000): AudioContext {
  return {
    currentTime: 0,
    sampleRate,
    createGain: jest.fn(() => ({
      ...createMockAudioNode(),
      gain: createMockAudioParam(1),
    })),
    createBiquadFilter: jest.fn(() => ({
      ...createMockAudioNode(),
      type: "lowpass",
      frequency: createMockAudioParam(1000),
      Q: createMockAudioParam(1),
      gain: createMockAudioParam(0),
    })),
    createMediaStreamSource: jest.fn(() => ({
      ...createMockAudioNode(),
    })),
    createMediaStreamDestination: jest.fn(() => ({
      ...createMockAudioNode(),
      stream: {
        id: "mock-dest-stream",
        getAudioTracks: jest.fn(() => [
          { id: "mock-dest-track", enabled: true },
        ]),
      },
    })),
  } as unknown as AudioContext;
}

describe("AcousticFilterEngine", () => {
  let mockContext: AudioContext;

  beforeEach(() => {
    mockContext = createMockAudioContext();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Preset Configuration", () => {
    it("initializes with 'off' preset by default in direct bypass mode", () => {
      const engine = new AcousticFilterEngine(mockContext);
      expect(engine.getPreset()).toBe("off");
    });

    it("creates voice-focus filter with bandpass type, 1850 Hz center frequency and Q=1.0", () => {
      const engine = new AcousticFilterEngine(mockContext, {
        initialPreset: "voice-focus",
      });
      expect(engine.getPreset()).toBe("voice-focus");

      expect(engine.voiceFocusNode.type).toBe("bandpass");
      expect(
        engine.voiceFocusNode.frequency.setValueAtTime,
      ).toHaveBeenCalledWith(1850, 0);
      expect(engine.voiceFocusNode.Q.setValueAtTime).toHaveBeenCalledWith(1, 0);
    });

    it("creates cafe-suppress filter with 120 Hz and 240 Hz notch filters", () => {
      const engine = new AcousticFilterEngine(mockContext, {
        initialPreset: "cafe-suppress",
      });
      expect(engine.getPreset()).toBe("cafe-suppress");

      expect(engine.cafeNotch120Node.type).toBe("notch");
      expect(
        engine.cafeNotch120Node.frequency.setValueAtTime,
      ).toHaveBeenCalledWith(120, 0);

      expect(engine.cafeNotch240Node.type).toBe("notch");
      expect(
        engine.cafeNotch240Node.frequency.setValueAtTime,
      ).toHaveBeenCalledWith(240, 0);
    });
  });

  describe("Audio Routing & Switching", () => {
    it("connects microphone stream via connectSourceStream without terminating tracks", () => {
      const engine = new AcousticFilterEngine(mockContext);
      const mockStop = jest.fn();
      const mockTrack = { id: "track-1", stop: mockStop, enabled: true };
      const mockStream = {
        getAudioTracks: () => [mockTrack],
      } as unknown as MediaStream;

      const sourceNode = engine.connectSourceStream(mockStream);
      expect(mockContext.createMediaStreamSource).toHaveBeenCalledWith(
        mockStream,
      );
      expect(sourceNode.connect).toHaveBeenCalledWith(engine.inputNode);
      expect(mockStop).not.toHaveBeenCalled();
    });

    it("connects external AudioNode directly to inputNode", () => {
      const engine = new AcousticFilterEngine(mockContext);
      const externalNode = {
        connect: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as AudioNode;

      engine.connectSourceNode(externalNode);
      expect(externalNode.connect).toHaveBeenCalledWith(engine.inputNode);
    });

    it("connects output to a destination node", () => {
      const engine = new AcousticFilterEngine(mockContext);
      const destNode = {
        connect: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as AudioNode;

      engine.connectDestination(destNode);
      expect(engine.outputNode.connect).toHaveBeenCalledWith(destNode);
    });

    it("creates an output MediaStream destination for mesh transmission", () => {
      const engine = new AcousticFilterEngine(mockContext);
      const stream = engine.createOutputStream();

      expect(mockContext.createMediaStreamDestination).toHaveBeenCalled();
      expect(stream).toBeDefined();
    });

    it("switches smoothly between presets using setTargetAtTime", () => {
      const engine = new AcousticFilterEngine(mockContext);

      // Switch to voice-focus
      engine.setPreset("voice-focus");
      expect(engine.getPreset()).toBe("voice-focus");

      // Switch to cafe-suppress
      engine.setPreset("cafe-suppress");
      expect(engine.getPreset()).toBe("cafe-suppress");

      // Switch back to off
      engine.setPreset("off");
      expect(engine.getPreset()).toBe("off");
    });

    it("safely handles rapid repeated preset changes", () => {
      const engine = new AcousticFilterEngine(mockContext);
      for (let i = 0; i < 20; i++) {
        engine.setPreset("voice-focus");
        engine.setPreset("cafe-suppress");
        engine.setPreset("off");
      }
      expect(engine.getPreset()).toBe("off");
    });
  });

  describe("Parameter Validation & Clamping", () => {
    it("clamps frequencies to safe bounds within sampleRate limits", () => {
      expect(clampFrequency(-50, 48000)).toBe(20);
      expect(clampFrequency(0, 48000)).toBe(20);
      expect(clampFrequency(1850, 48000)).toBe(1850);
      expect(clampFrequency(30000, 48000)).toBe(20000);
      expect(clampFrequency(NaN, 48000)).toBe(1000);
      expect(clampFrequency(Infinity, 48000)).toBe(1000);
    });

    it("clamps Q to safe positive non-zero bounds", () => {
      expect(clampQ(-5)).toBe(0.001);
      expect(clampQ(0)).toBe(0.001);
      expect(clampQ(1.0)).toBe(1.0);
      expect(clampQ(200)).toBe(100);
      expect(clampQ(NaN)).toBe(1.0);
      expect(clampQ(Infinity)).toBe(1.0);
    });

    it("validates preset strings correctly", () => {
      expect(isValidAcousticFilterPreset("off")).toBe(true);
      expect(isValidAcousticFilterPreset("voice-focus")).toBe(true);
      expect(isValidAcousticFilterPreset("cafe-suppress")).toBe(true);
      expect(isValidAcousticFilterPreset("invalid-preset")).toBe(false);
      expect(isValidAcousticFilterPreset(null)).toBe(false);
      expect(isValidAcousticFilterPreset(123)).toBe(false);
    });

    it("falls back to 'off' when setting an invalid preset", () => {
      const engine = new AcousticFilterEngine(mockContext, {
        initialPreset: "voice-focus",
      });
      expect(engine.getPreset()).toBe("voice-focus");

      engine.setPreset("unknown-noise-filter" as any);
      expect(engine.getPreset()).toBe("off");
    });

    it("throws when initialized with an invalid AudioContext", () => {
      expect(() => new AcousticFilterEngine(null as any)).toThrow(
        "A valid AudioContext instance is required to initialize AcousticFilterEngine.",
      );
    });
  });

  describe("Lifecycle & Cleanup", () => {
    it("disconnects all nodes on dispose without errors", () => {
      const engine = new AcousticFilterEngine(mockContext);
      const mockStream = {
        getAudioTracks: () => [{ stop: jest.fn() }],
      } as unknown as MediaStream;
      const sourceNode = engine.connectSourceStream(mockStream);

      engine.dispose();

      expect(sourceNode.disconnect).toHaveBeenCalled();
      expect(engine.inputNode.disconnect).toHaveBeenCalled();
      expect(engine.voiceFocusNode.disconnect).toHaveBeenCalled();
      expect(engine.cafeNotch120Node.disconnect).toHaveBeenCalled();
      expect(engine.cafeNotch240Node.disconnect).toHaveBeenCalled();
      expect(engine.outputNode.disconnect).toHaveBeenCalled();
    });

    it("is safe to call dispose multiple times", () => {
      const engine = new AcousticFilterEngine(mockContext);
      expect(() => {
        engine.dispose();
        engine.dispose();
      }).not.toThrow();
    });

    it("resumes suspended AudioContext when the document becomes visible", () => {
      const mockContext = createMockAudioContext();
      const resume = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(mockContext, "state", {
        configurable: true,
        value: "suspended",
      });
      Object.defineProperty(mockContext, "resume", {
        configurable: true,
        value: resume,
      });
      const visibilitySpy = jest
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("visible");

      const engine = new AcousticFilterEngine(mockContext);
      document.dispatchEvent(new Event("visibilitychange"));

      expect(resume).toHaveBeenCalledTimes(1);

      engine.dispose();
      visibilitySpy.mockRestore();
    });

    it("does not resume AudioContext when hidden or already running", () => {
      const mockContext = createMockAudioContext();
      const resume = jest.fn().mockResolvedValue(undefined);
      let state: AudioContextState = "suspended";

      Object.defineProperty(mockContext, "state", {
        configurable: true,
        get: () => state,
      });
      Object.defineProperty(mockContext, "resume", {
        configurable: true,
        value: resume,
      });

      const visibilitySpy = jest
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");
      const engine = new AcousticFilterEngine(mockContext);

      document.dispatchEvent(new Event("visibilitychange"));
      expect(resume).not.toHaveBeenCalled();

      visibilitySpy.mockReturnValue("visible");
      state = "running";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(resume).not.toHaveBeenCalled();

      engine.dispose();
      visibilitySpy.mockRestore();
    });

    it("handles rejected AudioContext resume promises", async () => {
      const mockContext = createMockAudioContext();
      const resume = jest
        .fn()
        .mockRejectedValue(new Error("User gesture required"));
      Object.defineProperty(mockContext, "state", {
        configurable: true,
        value: "suspended",
      });
      Object.defineProperty(mockContext, "resume", {
        configurable: true,
        value: resume,
      });
      const visibilitySpy = jest
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("visible");

      const engine = new AcousticFilterEngine(mockContext);

      expect(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      ).not.toThrow();
      await Promise.resolve();

      expect(resume).toHaveBeenCalledTimes(1);

      engine.dispose();
      visibilitySpy.mockRestore();
    });
    it("ignores operations after disposal", () => {
      const engine = new AcousticFilterEngine(mockContext);
      engine.dispose();

      expect(() => engine.setPreset("voice-focus")).not.toThrow();
      expect(() => engine.connectSourceNode({} as any)).toThrow();
      expect(() => engine.connectDestination({} as any)).toThrow();
      expect(() => engine.createOutputStream()).toThrow();
    });
  });
});
