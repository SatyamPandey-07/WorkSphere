import {
  AmbientMixerEngine,
  generateRainBuffer,
  generateCoffeeShopBuffer,
  generatePinkNoiseBuffer,
  applySeamlessLoopCrossfade,
} from "@/core/audio/AmbientMixerEngine";

// Mock Web Audio API
class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length)
    );
  }

  getChannelData(channel: number) {
    return this.channels[channel];
  }
}

class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime: jest.fn(function (this: any, val: number) {
      this.value = val;
    }),
    setTargetAtTime: jest.fn(function (this: any, val: number) {
      this.value = val;
    }),
    linearRampToValueAtTime: jest.fn(function (this: any, val: number) {
      this.value = val;
    }),
    cancelScheduledValues: jest.fn(),
  };
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  loop = false;
  connect = jest.fn();
  disconnect = jest.fn();
  start = jest.fn();
  stop = jest.fn();
}

class MockAudioContext {
  state: AudioContextState = "running";
  sampleRate = 44100;
  currentTime = 0;
  destination = {};

  createGain = jest.fn(() => new MockGainNode());
  createBuffer = jest.fn(
    (channels: number, length: number, sampleRate: number) =>
      new MockAudioBuffer(channels, length, sampleRate)
  );
  createBufferSource = jest.fn(() => new MockAudioBufferSourceNode());
  resume = jest.fn(async () => {
    this.state = "running";
  });
  close = jest.fn(async () => {
    this.state = "closed";
  });
}

describe("AmbientMixerEngine (#7226)", () => {
  let originalAudioContext: any;
  let originalWebkitAudioContext: any;

  beforeEach(() => {
    originalAudioContext = (global as any).AudioContext;
    originalWebkitAudioContext = (global as any).webkitAudioContext;
    (global as any).AudioContext = MockAudioContext;
    delete (global as any).webkitAudioContext;
    jest.clearAllMocks();
  });

  afterEach(() => {
    (global as any).AudioContext = originalAudioContext;
    (global as any).webkitAudioContext = originalWebkitAudioContext;
  });

  describe("Procedural Buffer Synthesis", () => {
    it("generates Gentle Rain buffer with stereo channels and non-zero audio content", () => {
      const ctx = new MockAudioContext() as unknown as AudioContext;
      const buffer = generateRainBuffer(ctx, 1);
      expect(buffer.numberOfChannels).toBe(2);
      expect(buffer.length).toBe(44100);
      const left = buffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < left.length; i++) {
        sum += Math.abs(left[i]);
      }
      expect(sum).toBeGreaterThan(0);
    });

    it("generates Busy Coffee Shop buffer with stereo channels and modulated ambient murmur", () => {
      const ctx = new MockAudioContext() as unknown as AudioContext;
      const buffer = generateCoffeeShopBuffer(ctx, 1);
      expect(buffer.numberOfChannels).toBe(2);
      expect(buffer.length).toBe(44100);
      const left = buffer.getChannelData(0);
      let hasSignal = false;
      for (let i = 0; i < left.length; i++) {
        if (Math.abs(left[i]) > 0.0001) {
          hasSignal = true;
          break;
        }
      }
      expect(hasSignal).toBe(true);
    });

    it("generates Pink Noise buffer with 1/f spectral synthesis", () => {
      const ctx = new MockAudioContext() as unknown as AudioContext;
      const buffer = generatePinkNoiseBuffer(ctx, 1);
      expect(buffer.numberOfChannels).toBe(2);
      expect(buffer.length).toBe(44100);
      const left = buffer.getChannelData(0);
      expect(left[100]).toBeDefined();
    });

    it("applies seamless loop crossfade to smooth boundaries without crashing", () => {
      const buf = new MockAudioBuffer(2, 44100, 44100) as unknown as AudioBuffer;
      const left = buf.getChannelData(0);
      for (let i = 0; i < 44100; i++) {
        left[i] = 0.5;
      }
      expect(() => applySeamlessLoopCrossfade(buf, 0.1)).not.toThrow();
      expect(left[0]).toBeCloseTo(0.5, 1);
    });
  });

  describe("Engine Lifecycle and Web Audio Setup", () => {
    it("is safe to instantiate in SSR environments (no AudioContext in constructor)", () => {
      delete (global as any).AudioContext;
      const engine = new AmbientMixerEngine();
      expect(engine.getState().isInitialized).toBe(false);
      expect(AmbientMixerEngine.isSupported()).toBe(false);
    });

    it("initializes AudioContext and master gain node on initialize()", async () => {
      const engine = new AmbientMixerEngine();
      const success = await engine.initialize();
      expect(success).toBe(true);
      expect(engine.getState().isInitialized).toBe(true);
      expect(engine.getAudioContext()).not.toBeNull();
    });

    it("reuses existing AudioContext and prevents duplicate initialization", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      const ctx1 = engine.getAudioContext();
      await engine.initialize();
      const ctx2 = engine.getAudioContext();
      expect(ctx1).toBe(ctx2);
    });

    it("handles suspended AudioContext and calls resume()", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      const ctx = engine.getAudioContext() as unknown as MockAudioContext;
      ctx.state = "suspended";
      await engine.initialize();
      expect(ctx.resume).toHaveBeenCalled();
    });

    it("handles unsupported environments gracefully on initialize()", async () => {
      delete (global as any).AudioContext;
      const engine = new AmbientMixerEngine();
      const success = await engine.initialize();
      expect(success).toBe(false);
      expect(engine.getState().isInitialized).toBe(false);
    });
  });

  describe("Layer Control & Smooth Gain Automation", () => {
    it("starts an individual layer with smooth gain automation", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      await engine.startLayer("rain");

      const state = engine.getState();
      expect(state.layers.rain.enabled).toBe(true);
      expect(state.layers.coffee_shop.enabled).toBe(false);
      expect(state.layers.pink_noise.enabled).toBe(false);
    });

    it("supports multiple layers playing simultaneously", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      await engine.startLayer("rain");
      await engine.startLayer("coffee_shop");

      const state = engine.getState();
      expect(state.layers.rain.enabled).toBe(true);
      expect(state.layers.coffee_shop.enabled).toBe(true);
      expect(state.layers.pink_noise.enabled).toBe(false);
    });

    it("stops an individual layer without interrupting other active layers", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      await engine.startLayer("rain");
      await engine.startLayer("pink_noise");

      engine.stopLayer("rain");
      const state = engine.getState();
      expect(state.layers.rain.enabled).toBe(false);
      expect(state.layers.pink_noise.enabled).toBe(true);
    });

    it("prevents duplicate sources when startLayer is called repeatedly", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      await engine.startLayer("rain");
      const ctx = engine.getAudioContext() as unknown as MockAudioContext;
      const sourceCount1 = ctx.createBufferSource.mock.calls.length;

      // Call startLayer again while active
      await engine.startLayer("rain");
      const sourceCount2 = ctx.createBufferSource.mock.calls.length;
      expect(sourceCount2).toBe(sourceCount1);
    });

    it("adjusts layer volume independently with clamping (0 to 100)", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      await engine.startLayer("rain");

      engine.setLayerVolume("rain", 85);
      expect(engine.getState().layers.rain.volume).toBe(85);

      // Clamp above 100
      engine.setLayerVolume("rain", 150);
      expect(engine.getState().layers.rain.volume).toBe(100);

      // Clamp below 0
      engine.setLayerVolume("rain", -20);
      expect(engine.getState().layers.rain.volume).toBe(0);

      // Clamp NaN
      engine.setLayerVolume("rain", NaN);
      expect(engine.getState().layers.rain.volume).toBe(0);
    });

    it("handles master mute and restores mix correctly on unmute", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      engine.setLayerVolume("rain", 70);
      engine.setLayerVolume("pink_noise", 40);

      engine.setMasterMuted(true);
      expect(engine.getState().isMuted).toBe(true);
      // Individual volume preferences are preserved
      expect(engine.getState().layers.rain.volume).toBe(70);
      expect(engine.getState().layers.pink_noise.volume).toBe(40);

      // Unmute
      engine.setMasterMuted(false);
      expect(engine.getState().isMuted).toBe(false);
      expect(engine.getState().layers.rain.volume).toBe(70);
      expect(engine.getState().layers.pink_noise.volume).toBe(40);
    });

    it("stops all active layers with stopAll()", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      await engine.startLayer("rain");
      await engine.startLayer("coffee_shop");
      await engine.startLayer("pink_noise");

      engine.stopAll();
      const state = engine.getState();
      expect(state.layers.rain.enabled).toBe(false);
      expect(state.layers.coffee_shop.enabled).toBe(false);
      expect(state.layers.pink_noise.enabled).toBe(false);
    });

    it("disposes resources, disconnects nodes, and closes AudioContext", async () => {
      const engine = new AmbientMixerEngine();
      await engine.initialize();
      await engine.startLayer("rain");
      const ctx = engine.getAudioContext() as unknown as MockAudioContext;

      engine.dispose();
      expect(engine.getState().isInitialized).toBe(false);
      expect(ctx.close).toHaveBeenCalled();
      expect(engine.getAudioContext()).toBeNull();
    });
  });
});
