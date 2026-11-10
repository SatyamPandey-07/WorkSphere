import {
  RoomReverbConvolver,
  generateImpulseResponse,
  ROOM_REVERB_PRESETS,
  type RoomAcousticPreset,
} from "@/lib/audio/RoomReverbConvolver";

function createMockAudioBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    channelData.push(new Float32Array(length));
  }

  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => channelData[ch] || channelData[0],
    copyFromChannel: jest.fn(),
    copyToChannel: jest.fn(),
  } as unknown as AudioBuffer;
}

function createMockAudioContext() {
  const mockGainNode = () => ({
    gain: {
      value: 1,
      setValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
  });

  const mockConvolverNode = () => ({
    buffer: null as AudioBuffer | null,
    connect: jest.fn(),
    disconnect: jest.fn(),
  });

  return {
    sampleRate: 44100,
    currentTime: 0,
    createGain: jest.fn(mockGainNode),
    createConvolver: jest.fn(mockConvolverNode),
    createBuffer: jest.fn((channels: number, length: number, sampleRate: number) =>
      createMockAudioBuffer(channels, length, sampleRate)
    ),
  } as unknown as AudioContext;
}

describe("RoomReverbConvolver & Room Acoustic Impulse Responses (#6486)", () => {
  let mockCtx: AudioContext;

  beforeEach(() => {
    mockCtx = createMockAudioContext();
  });

  describe("Preset Configurations (RT60 specifications)", () => {
    it("defines correct RT60 for phone_booth (0.15s)", () => {
      expect(ROOM_REVERB_PRESETS.phone_booth.rt60Seconds).toBe(0.15);
      expect(ROOM_REVERB_PRESETS.phone_booth.dryWetRatio).toBeLessThan(0.3);
    });

    it("defines correct RT60 for conference_room (0.45s)", () => {
      expect(ROOM_REVERB_PRESETS.conference_room.rt60Seconds).toBe(0.45);
    });

    it("defines correct RT60 for open_hall (1.2s)", () => {
      expect(ROOM_REVERB_PRESETS.open_hall.rt60Seconds).toBe(1.2);
      expect(ROOM_REVERB_PRESETS.open_hall.dryWetRatio).toBeGreaterThan(0.4);
    });
  });

  describe("generateImpulseResponse", () => {
    it("synthesizes buffer with sample length matching RT60 duration", () => {
      const buffer015 = generateImpulseResponse(mockCtx, 0.15);
      expect(buffer015.length).toBe(Math.ceil(44100 * 0.15));

      const buffer045 = generateImpulseResponse(mockCtx, 0.45);
      expect(buffer045.length).toBe(Math.ceil(44100 * 0.45));

      const buffer120 = generateImpulseResponse(mockCtx, 1.2);
      expect(buffer120.length).toBe(Math.ceil(44100 * 1.2));
    });

    it("produces exponential decay envelope where early samples have higher amplitude than tail samples", () => {
      const buffer = generateImpulseResponse(mockCtx, 0.45, { preDelaySeconds: 0 });
      const channel = buffer.getChannelData(0);

      const earlySlice = channel.slice(100, 500);
      const lateSlice = channel.slice(channel.length - 500, channel.length - 100);

      const calcRMS = (arr: Float32Array) => {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
        return Math.sqrt(sum / arr.length);
      };

      const earlyRMS = calcRMS(earlySlice);
      const lateRMS = calcRMS(lateSlice);

      expect(earlyRMS).toBeGreaterThan(lateRMS);
    });

    it("supports stereo channels and pre-delay window", () => {
      const buffer = generateImpulseResponse(mockCtx, 0.2, {
        channels: 2,
        preDelaySeconds: 0.01,
      });

      expect(buffer.numberOfChannels).toBe(2);
      const ch0 = buffer.getChannelData(0);
      // Samples before preDelay (0.01 * 44100 = 441 samples) should be silent (0)
      expect(ch0[10]).toBe(0);
      expect(ch0[50]).toBe(0);
    });
  });

  describe("RoomReverbConvolver Class Audio Graph", () => {
    it("initializes audio nodes and connects dry and wet routing paths", () => {
      const convolver = new RoomReverbConvolver(mockCtx, { preset: "conference_room" });

      expect(convolver.inputNode).toBeDefined();
      expect(convolver.outputNode).toBeDefined();
      expect(convolver.convolverNode).toBeDefined();
      expect(convolver.dryGain).toBeDefined();
      expect(convolver.wetGain).toBeDefined();
      expect(convolver.getPreset()).toBe("conference_room");
      expect(convolver.convolverNode.buffer).not.toBeNull();
    });

    it("switches room acoustic presets dynamically", () => {
      const convolver = new RoomReverbConvolver(mockCtx, { preset: "phone_booth" });
      expect(convolver.getPreset()).toBe("phone_booth");
      expect(convolver.getConfig().rt60Seconds).toBe(0.15);

      convolver.setRoomPreset("open_hall");
      expect(convolver.getPreset()).toBe("open_hall");
      expect(convolver.getConfig().rt60Seconds).toBe(1.2);
    });

    it("allows custom profile configuration and dry/wet ratio tuning", () => {
      const convolver = new RoomReverbConvolver(mockCtx);
      convolver.setCustomProfile({ rt60Seconds: 0.8, dryWetRatio: 0.5 });

      expect(convolver.getPreset()).toBe("custom");
      expect(convolver.getConfig().rt60Seconds).toBe(0.8);
      expect(convolver.getConfig().dryWetRatio).toBe(0.5);

      convolver.setDryWetRatio(0.7);
      expect(convolver.getConfig().dryWetRatio).toBe(0.7);
    });

    it("safely disconnects graph nodes on cleanup", () => {
      const convolver = new RoomReverbConvolver(mockCtx);
      expect(() => convolver.disconnect()).not.toThrow();
    });
  });
});
