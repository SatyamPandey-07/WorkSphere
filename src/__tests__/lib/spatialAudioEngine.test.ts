/**
 * spatialAudioEngine.test.ts
 *
 * Comprehensive unit and integration test suite for Issue #7527:
 * Web Audio ConvolverNode HRTF Spatial Acoustic Room Simulation.
 */

import {
  SpatialAudioEngine,
  generateProceduralImpulseResponse,
  calculateSabineRT60,
  resolveMaterialAbsorption,
  resolveRoomAcoustics,
  ACOUSTIC_PROFILE_PRESETS,
  MATERIAL_ABSORPTION_COEFFICIENTS,
  type RoomDimensions,
} from '@/lib/audio/spatialAudioEngine';

// ─── MOCK WEB AUDIO HELPERS ──────────────────────────────────────────────────

function createMockAudioParam(initialValue: number = 0) {
  return {
    value: initialValue,
    setValueAtTime: jest.fn(function (val: number) {
      this.value = val;
    }),
    linearRampToValueAtTime: jest.fn(function (val: number) {
      this.value = val;
    }),
    setTargetAtTime: jest.fn(function (val: number) {
      this.value = val;
    }),
  };
}

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
    getChannelData: jest.fn((ch: number) => channelData[ch] || channelData[0]),
    copyFromChannel: jest.fn(),
    copyToChannel: jest.fn(),
  } as unknown as AudioBuffer;
}

function createMockAudioContext(options: { sampleRate?: number; currentTime?: number } = {}) {
  const sampleRate = options.sampleRate ?? 44100;
  let currentTime = options.currentTime ?? 0;

  const mockDestination = {
    channelCount: 2,
    connect: jest.fn(),
    disconnect: jest.fn(),
  };

  const mockListener = {
    positionX: createMockAudioParam(0),
    positionY: createMockAudioParam(0),
    positionZ: createMockAudioParam(0),
    forwardX: createMockAudioParam(0),
    forwardY: createMockAudioParam(0),
    forwardZ: createMockAudioParam(-1),
    upX: createMockAudioParam(0),
    upY: createMockAudioParam(1),
    upZ: createMockAudioParam(0),
    setPosition: jest.fn(),
    setOrientation: jest.fn(),
  };

  const createGain = jest.fn(() => ({
    gain: createMockAudioParam(1.0),
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));

  const createConvolver = jest.fn(() => ({
    buffer: null as AudioBuffer | null,
    normalize: true,
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));

  const createPanner = jest.fn(() => ({
    panningModel: 'HRTF' as PanningModelType,
    distanceModel: 'inverse' as DistanceModelType,
    refDistance: 1.0,
    maxDistance: 50.0,
    rolloffFactor: 1.0,
    coneInnerAngle: 360,
    coneOuterAngle: 0,
    coneOuterGain: 0,
    positionX: createMockAudioParam(0),
    positionY: createMockAudioParam(0),
    positionZ: createMockAudioParam(0),
    orientationX: createMockAudioParam(0),
    orientationY: createMockAudioParam(0),
    orientationZ: createMockAudioParam(-1),
    setPosition: jest.fn(),
    setOrientation: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));

  const createBuffer = jest.fn((channels: number, length: number, sRate: number) =>
    createMockAudioBuffer(channels, length, sRate)
  );

  const createMediaStreamSource = jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));

  const close = jest.fn().mockResolvedValue(undefined);

  return {
    sampleRate,
    get currentTime() {
      return currentTime;
    },
    set currentTime(val: number) {
      currentTime = val;
    },
    destination: mockDestination,
    listener: mockListener,
    createGain,
    createConvolver,
    createPanner,
    createBuffer,
    createMediaStreamSource,
    close,
  } as unknown as AudioContext & { close: jest.Mock };
}

// ─── TEST SUITE ─────────────────────────────────────────────────────────────

describe('Web Audio ConvolverNode HRTF Spatial Acoustic Room Simulation (#7527)', () => {
  let mockCtx: ReturnType<typeof createMockAudioContext>;

  beforeEach(() => {
    mockCtx = createMockAudioContext();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // A. Procedural Synthetic Impulse Response Generator
  // ═══════════════════════════════════════════════════════════════════════════
  describe('A. Procedural Synthetic Impulse Response Generator', () => {
    it('creates a valid AudioBuffer with expected channels, length, and sample rate', () => {
      const buffer = generateProceduralImpulseResponse(mockCtx, {
        rt60: 0.45,
        dimensions: { width: 8, length: 12, height: 3 },
      });

      expect(buffer).toBeDefined();
      expect(buffer.numberOfChannels).toBe(2);
      expect(buffer.sampleRate).toBe(44100);
      expect(buffer.length).toBe(Math.ceil(44100 * 0.45));
      expect(buffer.duration).toBeCloseTo(0.45, 2);
    });

    it('ensures all generated samples are finite, within [-1.0, 1.0], with no NaN or Infinity', () => {
      const buffer = generateProceduralImpulseResponse(mockCtx, {
        rt60: 0.3,
        dimensions: { width: 5, length: 5, height: 2.5 },
      });

      let allFinite = true;
      let minVal = 0;
      let maxVal = 0;

      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          const sample = data[i];
          if (!Number.isFinite(sample) || Number.isNaN(sample)) {
            allFinite = false;
          }
          if (sample < minVal) minVal = sample;
          if (sample > maxVal) maxVal = sample;
        }
      }

      expect(allFinite).toBe(true);
      expect(minVal).toBeGreaterThanOrEqual(-1.0);
      expect(maxVal).toBeLessThanOrEqual(1.0);
    });

    it('models exact RT60 exponential decay: early energy is substantially higher than tail energy', () => {
      const buffer = generateProceduralImpulseResponse(
        mockCtx,
        {
          rt60: 0.5,
          preDelaySeconds: 0.0,
          dampingFactor: 2.0,
        },
        { seed: 12345 }
      );

      const channel = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;

      // Slice at 20ms - 60ms (early) vs slice at 400ms - 440ms (tail near RT60)
      const earlySlice = channel.slice(Math.floor(0.02 * sampleRate), Math.floor(0.06 * sampleRate));
      const tailSlice = channel.slice(Math.floor(0.40 * sampleRate), Math.floor(0.44 * sampleRate));

      const calcRMS = (arr: Float32Array) => {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
        return Math.sqrt(sum / arr.length);
      };

      const earlyRMS = calcRMS(earlySlice);
      const tailRMS = calcRMS(tailSlice);

      expect(earlyRMS).toBeGreaterThan(0);
      expect(tailRMS).toBeGreaterThan(0);
      // Theoretical exponential decay over ~0.38s with RT60=0.5s:
      // decay ratio = exp(-6.9078 * 0.38 / 0.5) ≈ exp(-5.25) ≈ 0.0052 (-45 dB)
      expect(earlyRMS).toBeGreaterThan(tailRMS * 10);
    });

    it('generates direct sound impulse and specular early reflections prior to late diffuse reverb', () => {
      const buffer = generateProceduralImpulseResponse(
        mockCtx,
        {
          dimensions: { width: 6, length: 8, height: 3 },
          preDelaySeconds: 0.005,
          reflectionIntensity: 0.8,
          rt60: 0.5,
        },
        { seed: 999 }
      );

      const ch0 = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;

      // Samples prior to preDelay (0.005 * 44100 = 220 samples) should be silence
      expect(ch0[10]).toBe(0);
      expect(ch0[50]).toBe(0);

      // Direct sound impulse exists around preDelay
      const directSample = Math.floor(0.005 * sampleRate);
      expect(ch0[directSample]).toBeGreaterThan(0.5);

      // Early reflection arrivals occur after direct sound but before mixing time (~40ms)
      const earlyWindow = ch0.slice(directSample + 5, Math.floor(0.04 * sampleRate));
      let hasEarlyPeak = false;
      for (let i = 0; i < earlyWindow.length; i++) {
        if (Math.abs(earlyWindow[i]) > 0.05) {
          hasEarlyPeak = true;
          break;
        }
      }
      expect(hasEarlyPeak).toBe(true);
    });

    it('produces 100% deterministic, reproducible impulse responses when a seed is provided', () => {
      const bufferA = generateProceduralImpulseResponse(
        mockCtx,
        { rt60: 0.25, dimensions: { width: 4, length: 4, height: 2.5 } },
        { seed: 777 }
      );

      const bufferB = generateProceduralImpulseResponse(
        mockCtx,
        { rt60: 0.25, dimensions: { width: 4, length: 4, height: 2.5 } },
        { seed: 777 }
      );

      const dataA = bufferA.getChannelData(0);
      const dataB = bufferB.getChannelData(0);

      expect(dataA.length).toBe(dataB.length);
      for (let i = 0; i < dataA.length; i++) {
        expect(dataA[i]).toBe(dataB[i]);
      }
    });

    it('handles invalid, negative, or NaN parameters gracefully with safe physical fallbacks', () => {
      const buffer = generateProceduralImpulseResponse(mockCtx, {
        rt60: -5.0, // Invalid negative RT60
        dimensions: { width: NaN, length: -10, height: 0 },
        preDelaySeconds: NaN,
        wetDryRatio: 50.0, // Out-of-bounds ratio
      });

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThanOrEqual(128);
      expect(buffer.duration).toBeGreaterThanOrEqual(0.05);

      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        expect(Number.isFinite(data[i])).toBe(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B. Dynamic Room Acoustic Simulation & Physical Venue Properties
  // ═══════════════════════════════════════════════════════════════════════════
  describe('B. Dynamic Room Acoustic Simulation', () => {
    it('calculates Sabine RT60 accurately based on room volume and surface absorption', () => {
      const dimensions: RoomDimensions = { width: 10, length: 10, height: 3 };
      // Volume = 10 * 10 * 3 = 300 m³
      // Surface area = 2 * (100 + 30 + 30) = 320 m²
      // With average absorption = 0.2: Total absorption A = 320 * 0.2 = 64
      // RT60 = 0.1611 * 300 / 64 ≈ 0.755s
      const sabine = calculateSabineRT60(dimensions, { averageAbsorption: 0.2 });

      expect(sabine.volume).toBe(300);
      expect(sabine.surfaceArea).toBe(320);
      expect(sabine.averageAbsorption).toBe(0.2);
      expect(sabine.rt60).toBeCloseTo(0.755, 2);
    });

    it('resolves material absorption coefficients accurately', () => {
      expect(resolveMaterialAbsorption('concrete')).toBe(MATERIAL_ABSORPTION_COEFFICIENTS.concrete);
      expect(resolveMaterialAbsorption('acoustic_panel')).toBe(MATERIAL_ABSORPTION_COEFFICIENTS.acoustic_panel);
      expect(resolveMaterialAbsorption('carpet')).toBe(MATERIAL_ABSORPTION_COEFFICIENTS.carpet);
      expect(resolveMaterialAbsorption(0.42)).toBe(0.42);
      expect(resolveMaterialAbsorption(5.0)).toBe(0.99); // Clamped
      expect(resolveMaterialAbsorption(-1.0)).toBe(0.01); // Clamped
    });

    it('provides distinct physical acoustic profiles for small booth, coworking, and cafe', () => {
      const booth = ACOUSTIC_PROFILE_PRESETS.small_booth;
      const coworking = ACOUSTIC_PROFILE_PRESETS.medium_coworking;
      const cafe = ACOUSTIC_PROFILE_PRESETS.large_cafe;

      // Small private booth: short RT60, small volume, high damping, low wet/dry
      expect(booth.rt60).toBeLessThan(0.25);
      expect(booth.dampingFactor).toBeGreaterThan(3.0);
      expect(booth.wetDryRatio).toBeLessThan(0.25);
      expect(booth.preDelaySeconds).toBeLessThan(0.005);

      // Medium coworking room: balanced RT60 and ambience
      expect(coworking.rt60).toBeGreaterThanOrEqual(0.35);
      expect(coworking.rt60).toBeLessThanOrEqual(0.65);
      expect(coworking.wetDryRatio).toBeCloseTo(0.35, 1);

      // Large loft cafe: longer RT60, larger volume, lower damping, higher wet/dry
      expect(cafe.rt60).toBeGreaterThanOrEqual(1.0);
      expect(cafe.dimensions.width).toBeGreaterThan(coworking.dimensions.width);
      expect(cafe.wetDryRatio).toBeGreaterThan(0.45);
      expect(cafe.preDelaySeconds).toBeGreaterThan(coworking.preDelaySeconds ?? 0);
    });

    it('supports backward-compatible alias presets (phone_booth, conference_room, open_hall)', () => {
      expect(ACOUSTIC_PROFILE_PRESETS.phone_booth).toBe(ACOUSTIC_PROFILE_PRESETS.small_booth);
      expect(ACOUSTIC_PROFILE_PRESETS.conference_room).toBe(ACOUSTIC_PROFILE_PRESETS.medium_coworking);
      expect(ACOUSTIC_PROFILE_PRESETS.open_hall).toBe(ACOUSTIC_PROFILE_PRESETS.large_cafe);
    });

    it('normalizes room acoustic properties safely via resolveRoomAcoustics', () => {
      const resolved = resolveRoomAcoustics({
        dimensions: { width: 5, length: 6, height: 3 },
        dampingFactor: 10.0, // should clamp to 5.0
        wetDryRatio: -0.5, // should clamp to 0.0
      });

      expect(resolved.dampingFactor).toBe(5.0);
      expect(resolved.wetDryRatio).toBe(0.0);
      expect(resolved.volume).toBe(90);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C. Web Audio ConvolverNode and HRTF PannerNode Integration
  // ═══════════════════════════════════════════════════════════════════════════
  describe('C. Web Audio ConvolverNode and HRTF PannerNode Integration', () => {
    it('initializes the full audio graph with dual convolvers, dry/wet summing, and master gain', () => {
      const engine = new SpatialAudioEngine({
        audioContext: mockCtx,
        preset: 'medium_coworking',
      });

      expect(mockCtx.createGain).toHaveBeenCalled();
      expect(mockCtx.createConvolver).toHaveBeenCalledTimes(2); // Ping-pong convolverA & convolverB
      expect(engine.getOutputNode()).toBeDefined();
      expect(engine.getDryGainNode()).toBeDefined();
      expect(engine.getWetGainNode()).toBeDefined();
      expect(engine.getReverbBus()).toBeDefined();
      expect(engine.getCurrentImpulseResponse()).not.toBeNull();
      expect(engine.getActiveConvolverId()).toBe('A');

      engine.dispose();
    });

    it('attaches a remote participant with native HRTF PannerNode and parallel dry/wet routing', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx });
      const mockStream = {} as MediaStream;

      const participant = engine.addParticipant('peer-1', mockStream, { x: 3, y: 1.5, z: -4 });

      expect(participant.id).toBe('peer-1');
      expect(mockCtx.createMediaStreamSource).toHaveBeenCalledWith(mockStream);
      expect(mockCtx.createPanner).toHaveBeenCalled();

      // Verify HRTF configuration
      const panner = participant.pannerNode;
      expect(panner.panningModel).toBe('HRTF');
      expect(panner.distanceModel).toBe('inverse');
      expect(panner.refDistance).toBe(1.0);
      expect(panner.maxDistance).toBe(50.0);
      expect(panner.rolloffFactor).toBe(1.0);
      expect(panner.coneInnerAngle).toBe(360);

      // Verify initial coordinates
      expect(participant.position).toEqual({ x: 3, y: 1.5, z: -4 });
      expect(panner.positionX.setValueAtTime).toHaveBeenCalledWith(3, mockCtx.currentTime);
      expect(panner.positionY.setValueAtTime).toHaveBeenCalledWith(1.5, mockCtx.currentTime);
      expect(panner.positionZ.setValueAtTime).toHaveBeenCalledWith(-4, mockCtx.currentTime);

      // Verify Dry and Wet connections
      expect(participant.sourceNode.connect).toHaveBeenCalledWith(participant.dryGainNode);
      expect(participant.dryGainNode.connect).toHaveBeenCalledWith(panner);
      expect(panner.connect).toHaveBeenCalledWith(engine.getDryGainNode());

      expect(participant.sourceNode.connect).toHaveBeenCalledWith(participant.sendGainNode);
      expect(participant.sendGainNode.connect).toHaveBeenCalledWith(engine.getReverbBus());

      engine.dispose();
    });

    it('attaches an existing AudioNode source directly without re-wrapping', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx });
      const mockAudioNode = {
        connect: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as AudioNode;

      const participant = engine.addParticipant('peer-custom-node', mockAudioNode);
      expect(participant.sourceNode).toBe(mockAudioNode);

      engine.dispose();
    });

    it('re-attaching a participant with same ID detaches old nodes without duplicate connections', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx });
      const mockStream1 = {} as MediaStream;
      const mockStream2 = {} as MediaStream;

      const p1 = engine.addParticipant('peer-dup', mockStream1);
      const firstPannerDisconnect = jest.spyOn(p1.pannerNode, 'disconnect');

      const p2 = engine.addParticipant('peer-dup', mockStream2);

      expect(firstPannerDisconnect).toHaveBeenCalled();
      expect(engine.getParticipants().size).toBe(1);
      expect(engine.getParticipant('peer-dup')).toBe(p2);

      engine.dispose();
    });

    it('updates participant position in real time', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx });
      const mockStream = {} as MediaStream;
      const participant = engine.addParticipant('peer-move', mockStream);

      engine.updateParticipantPosition('peer-move', 10, 2, -15);

      expect(participant.position).toEqual({ x: 10, y: 2, z: -15 });
      expect(participant.pannerNode.positionX.setValueAtTime).toHaveBeenCalledWith(10, mockCtx.currentTime);
      expect(participant.pannerNode.positionY.setValueAtTime).toHaveBeenCalledWith(2, mockCtx.currentTime);
      expect(participant.pannerNode.positionZ.setValueAtTime).toHaveBeenCalledWith(-15, mockCtx.currentTime);

      engine.dispose();
    });

    it('updates listener 3D position and orientation vectors in world space', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx });

      engine.updateListenerPosition(5, 1.8, -2);
      expect(engine.getListenerPosition()).toEqual({ x: 5, y: 1.8, z: -2 });
      expect(mockCtx.listener.positionX.setValueAtTime).toHaveBeenCalledWith(5, mockCtx.currentTime);
      expect(mockCtx.listener.positionY.setValueAtTime).toHaveBeenCalledWith(1.8, mockCtx.currentTime);
      expect(mockCtx.listener.positionZ.setValueAtTime).toHaveBeenCalledWith(-2, mockCtx.currentTime);

      engine.updateListenerOrientation(0, 0, 1, 0, 1, 0);
      expect(mockCtx.listener.forwardX.setValueAtTime).toHaveBeenCalledWith(0, mockCtx.currentTime);
      expect(mockCtx.listener.forwardY.setValueAtTime).toHaveBeenCalledWith(0, mockCtx.currentTime);
      expect(mockCtx.listener.forwardZ.setValueAtTime).toHaveBeenCalledWith(1, mockCtx.currentTime);

      engine.dispose();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // D. Dynamic Acoustic Updates & Ping-Pong Crossfading
  // ═══════════════════════════════════════════════════════════════════════════
  describe('D. Dynamic Acoustic Updates', () => {
    it('switches room presets with ping-pong convolver crossfading', () => {
      const engine = new SpatialAudioEngine({
        audioContext: mockCtx,
        preset: 'small_booth',
      });

      expect(engine.getPreset()).toBe('small_booth');
      expect(engine.getActiveConvolverId()).toBe('A');

      // Switch to large_cafe
      engine.setRoomPreset('large_cafe');

      expect(engine.getPreset()).toBe('large_cafe');
      // Convolver B is now active target
      expect(engine.getActiveConvolverId()).toBe('B');
      expect(engine.getRoomProperties().rt60).toBe(1.2);

      // Switch back to medium_coworking
      engine.setRoomPreset('medium_coworking');
      expect(engine.getActiveConvolverId()).toBe('A');

      engine.dispose();
    });

    it('does not regenerate impulse response when position or identical properties update', () => {
      const engine = new SpatialAudioEngine({
        audioContext: mockCtx,
        preset: 'medium_coworking',
      });

      const initialIR = engine.getCurrentImpulseResponse();
      const createBufferSpy = jest.spyOn(mockCtx, 'createBuffer');
      createBufferSpy.mockClear();

      // Add and move participant
      engine.addParticipant('peer-pos', {} as MediaStream);
      engine.updateParticipantPosition('peer-pos', 15, 0, 20);
      engine.updateListenerPosition(2, 0, 1);

      // Ensure no AudioBuffer was recreated during position updates
      expect(createBufferSpy).not.toHaveBeenCalled();
      expect(engine.getCurrentImpulseResponse()).toBe(initialIR);

      // Setting identical properties should not recreate buffer
      engine.setRoomProperties({});
      expect(createBufferSpy).not.toHaveBeenCalled();

      engine.dispose();
    });

    it('adjusts master dry/wet ratio dynamically without interrupting the audio graph', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx });

      engine.setWetDryRatio(0.75);
      expect(engine.getWetDryRatio()).toBe(0.75);

      const dryGain = engine.getDryGainNode();
      const wetGain = engine.getWetGainNode();

      expect(dryGain.gain.setValueAtTime).toHaveBeenCalledWith(0.25, mockCtx.currentTime);
      expect(wetGain.gain.setValueAtTime).toHaveBeenCalledWith(0.75, mockCtx.currentTime);

      engine.dispose();
    });

    it('toggles master mute and volume controls smoothly', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx, initialMasterGain: 0.8 });

      expect(engine.getMasterGain()).toBe(0.8);
      expect(engine.getIsMuted()).toBe(false);

      const muted = engine.toggleMute();
      expect(muted).toBe(true);
      expect(engine.getIsMuted()).toBe(true);
      expect(engine.getOutputNode().gain.setValueAtTime).toHaveBeenCalledWith(0.0, mockCtx.currentTime);

      const unmuted = engine.toggleMute();
      expect(unmuted).toBe(false);
      expect(engine.getIsMuted()).toBe(false);
      expect(engine.getOutputNode().gain.setValueAtTime).toHaveBeenCalledWith(0.8, mockCtx.currentTime);

      engine.setMasterGain(0.5);
      expect(engine.getMasterGain()).toBe(0.5);

      engine.dispose();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // E. Audio Resource Management & Cleanup Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════
  describe('E. Audio Resource Management & Lifecycle', () => {
    it('safely disconnects participant nodes on removal', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx });
      const participant = engine.addParticipant('peer-clean', {} as MediaStream);

      const disconnectSource = jest.spyOn(participant.sourceNode, 'disconnect');
      const disconnectDry = jest.spyOn(participant.dryGainNode, 'disconnect');
      const disconnectSend = jest.spyOn(participant.sendGainNode, 'disconnect');
      const disconnectPanner = jest.spyOn(participant.pannerNode, 'disconnect');

      engine.removeParticipant('peer-clean');

      expect(disconnectSource).toHaveBeenCalled();
      expect(disconnectDry).toHaveBeenCalled();
      expect(disconnectSend).toHaveBeenCalled();
      expect(disconnectPanner).toHaveBeenCalled();
      expect(engine.getParticipant('peer-clean')).toBeUndefined();

      engine.dispose();
    });

    it('disconnects all graph nodes and handles repeated disposal idempotently', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx });
      engine.addParticipant('peer-1', {} as MediaStream);
      engine.addParticipant('peer-2', {} as MediaStream);

      expect(engine.isDestroyed()).toBe(false);

      // First disposal
      expect(() => engine.dispose()).not.toThrow();
      expect(engine.isDestroyed()).toBe(true);
      expect(engine.getParticipants().size).toBe(0);

      // Repeated disposal must be safe no-op
      expect(() => engine.dispose()).not.toThrow();
      expect(engine.isDestroyed()).toBe(true);
    });

    it('does not close externally owned AudioContext on engine disposal', () => {
      const externalCtx = createMockAudioContext();
      const engine = new SpatialAudioEngine({ audioContext: externalCtx });

      engine.dispose();

      // Externally owned AudioContext must remain open
      expect(externalCtx.close).not.toHaveBeenCalled();
    });

    it('safely closes internally owned AudioContext on disposal', () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      const MockAudioContext = jest.fn().mockImplementation(() => ({
        ...createMockAudioContext(),
        close: mockClose,
      }));

      const origAudioContext = (globalThis as unknown as { AudioContext: unknown }).AudioContext;
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;

      try {
        const engine = new SpatialAudioEngine();
        engine.dispose();
        expect(mockClose).toHaveBeenCalled();
      } finally {
        (globalThis as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
      }
    });

    it('guards operations after disposal against crashing', () => {
      const engine = new SpatialAudioEngine({ audioContext: mockCtx });
      engine.dispose();

      expect(() => engine.setRoomPreset('small_booth')).not.toThrow();
      expect(() => engine.setRoomProperties({ rt60: 0.5 })).not.toThrow();
      expect(() => engine.updateListenerPosition(1, 2, 3)).not.toThrow();
      expect(() => engine.updateParticipantPosition('peer', 1, 2, 3)).not.toThrow();
      expect(() => engine.setMasterGain(0.5)).not.toThrow();
      expect(() => engine.addParticipant('peer', {} as MediaStream)).toThrow();
    });
  });
});
