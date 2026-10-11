/**
 * PrivacyZoneManager.test.ts
 * Tests for PrivacyZoneManager HRTF spatial acoustics, orientation tracking, and latency benchmarking.
 */

import {
  PrivacyZoneManager,
  SpatialEntity,
  BEAM_PRESETS,
} from "@/core/audio/PrivacyZoneManager";

describe("PrivacyZoneManager HRTF & Orientation Tracking", () => {
  let mockAudioContext: any;
  let mockListener: any;
  let mockPannerNode: any;
  let mockGainNode: any;

  beforeEach(() => {
    mockListener = {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: -1 },
      upX: { value: 0 },
      upY: { value: 1 },
      upZ: { value: 0 },
    };

    mockGainNode = {
      gain: {
        value: 1.0,
        setValueAtTime: jest.fn((val: number) => {
          mockGainNode.gain.value = val;
        }),
      },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockPannerNode = {
      panningModel: "HRTF",
      distanceModel: "inverse",
      refDistance: 1,
      maxDistance: 100,
      rolloffFactor: 1,
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockAudioContext = {
      currentTime: 1.0,
      destination: {},
      listener: mockListener,
      createGain: jest.fn(() => ({
        ...mockGainNode,
        gain: { ...mockGainNode.gain },
      })),
      createPanner: jest.fn(() => ({
        ...mockPannerNode,
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
      })),
    };
  });

  describe("PannerNode Configuration", () => {
    it("configures panningModel = 'HRTF' and distanceModel = 'inverse'", () => {
      const manager = new PrivacyZoneManager("user-1", 3.0, mockAudioContext);
      const panner = manager.createPannerNode("entity-1");

      expect(panner).toBeDefined();
      expect(panner!.panningModel).toBe("HRTF");
      expect(panner!.distanceModel).toBe("inverse");
    });

    it("creates and manages HRTF PannerNodes for added entities", () => {
      const manager = new PrivacyZoneManager("user-1", 3.0, mockAudioContext);
      const entity: SpatialEntity = {
        id: "desk-2",
        x: 2.0,
        y: 0.0,
        z: 1.5,
        isTrusted: false,
      };

      manager.updateEntity(entity);

      const panner = manager.getPannerNode("desk-2");
      expect(panner).toBeDefined();
      expect(panner!.panningModel).toBe("HRTF");
      expect(panner!.distanceModel).toBe("inverse");
      expect(panner!.positionX.value).toBe(2.0);
      expect(panner!.positionY.value).toBe(0.0);
      expect(panner!.positionZ.value).toBe(1.5);
    });

    it("cleans up panner nodes when entity is removed", () => {
      const manager = new PrivacyZoneManager("user-1", 3.0, mockAudioContext);
      const entity: SpatialEntity = {
        id: "desk-2",
        x: 1,
        y: 0,
        z: 1,
        isTrusted: false,
      };

      manager.updateEntity(entity);
      expect(manager.getPannerNode("desk-2")).toBeDefined();

      manager.removeEntity("desk-2");
      expect(manager.getPannerNode("desk-2")).toBeUndefined();
    });
  });

  describe("DeviceOrientation Tracking", () => {
    it("listens to deviceorientation events and updates listener forward/up vectors", () => {
      const addSpy = jest.spyOn(window, "addEventListener");
      const removeSpy = jest.spyOn(window, "removeEventListener");

      const manager = new PrivacyZoneManager("user-1", 2.0, mockAudioContext);
      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        true,
      );

      // Simulate deviceorientation event
      const event = {
        alpha: 90, // 90 deg yaw
        beta: 0,
        gamma: 0,
      } as DeviceOrientationEvent;

      manager.handleDeviceOrientation(event);

      const orientation = manager.getListenerOrientation();
      expect(orientation.forward).toBeDefined();
      expect(orientation.up).toBeDefined();
      expect(mockListener.forwardX.value).toBeCloseTo(orientation.forward.x, 3);
      expect(mockListener.upY.value).toBeCloseTo(orientation.up.y, 3);

      manager.stopOrientationTracking();
      expect(removeSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        true,
      );
      expect(manager.getIsTrackingOrientation()).toBe(false);

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it("dynamically adjusts forward and up vectors with pitch and roll", () => {
      const manager = new PrivacyZoneManager("user-1", 2.0, mockAudioContext);

      const result = manager.updateOrientationFromAngles(45, 30, 15);
      expect(result.forward.x).toBeDefined();
      expect(result.forward.y).toBeDefined();
      expect(result.forward.z).toBeDefined();
      expect(result.up.x).toBeDefined();
      expect(result.up.y).toBeDefined();
      expect(result.up.z).toBeDefined();

      // Vectors should be normalized / non-zero
      const forwardMag = Math.sqrt(
        result.forward.x ** 2 + result.forward.y ** 2 + result.forward.z ** 2,
      );
      expect(forwardMag).toBeCloseTo(1.0, 2);
    });
  });

  describe("Audio Latency Benchmark", () => {
    it("ensures spatial recalculation completes within 10ms", () => {
      const manager = new PrivacyZoneManager("user-1", 5.0, mockAudioContext);

      // Add multiple entities representing adjacent desks
      for (let i = 0; i < 10; i++) {
        manager.updateEntity({
          id: `desk-${i}`,
          x: Math.cos((i * Math.PI) / 5) * 3,
          y: 0,
          z: Math.sin((i * Math.PI) / 5) * 3,
          isTrusted: i % 2 === 0,
        });
      }

      const benchmark = manager.benchmarkSpatialRecalculation(
        { x: 0, y: 0, z: 0 },
        100,
      );

      expect(benchmark.iterations).toBe(100);
      expect(benchmark.averageLatencyMs).toBeLessThanOrEqual(10.0);
      expect(benchmark.withinBudget).toBe(true);
      expect(benchmark.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("recalculates masking and updates gains during spatial acoustic recalculation", () => {
      const manager = new PrivacyZoneManager("user-1", 4.0, mockAudioContext);
      manager.updateEntity({
        id: "untrusted-1",
        x: 1.0,
        y: 0.0,
        z: 0.0,
        isTrusted: false,
      });

      const masking = manager.recalculateSpatialAcoustics(
        { x: 0, y: 0, z: 0 },
        { alpha: 0, beta: 0, gamma: 0 },
      );
      expect(masking).toBeGreaterThan(0.0);

      const gain = manager.getGainNode("untrusted-1");
      expect(gain).toBeDefined();
    });
  });

  describe("Backward Compatibility", () => {
    it("calculates masking and nearby untrusted count identically to previous implementation", () => {
      const manager = new PrivacyZoneManager("user-1", 2.0);
      manager.updateEntity({
        id: "user-1",
        x: 0,
        y: 0,
        z: 0,
        isTrusted: false,
      });
      manager.updateEntity({
        id: "trusted-1",
        x: 1,
        y: 0,
        z: 0,
        isTrusted: true,
      });
      manager.updateEntity({
        id: "untrusted-1",
        x: 1,
        y: 0,
        z: 0,
        isTrusted: false,
      });

      const threat = manager.calculateRequiredMasking({ x: 0, y: 0, z: 0 });
      expect(threat).toBeCloseTo(0.5, 3);

      const count = manager.getNearbyUntrustedCount({ x: 0, y: 0, z: 0 });
      expect(count).toBe(1);
    });
  });

  describe("Beamforming Presets & Filter Weight Reconfiguration", () => {
    it("defines the preset dictionary with correct names, polar patterns, and weights", () => {
      expect(BEAM_PRESETS.narrow.name).toBe("Narrow Focus");
      expect(BEAM_PRESETS.narrow.description).toBe("single speaker cardioid");
      expect(BEAM_PRESETS.narrow.polarPattern).toBe("cardioid");
      expect(BEAM_PRESETS.narrow.polarWeights.front).toBe(1.0);
      expect(BEAM_PRESETS.narrow.polarWeights.back).toBe(0.0);

      expect(BEAM_PRESETS.meeting.name).toBe("Meeting Mode");
      expect(BEAM_PRESETS.meeting.description).toBe("bilateral interview");
      expect(BEAM_PRESETS.meeting.polarPattern).toBe("bidirectional");
      expect(BEAM_PRESETS.meeting.polarWeights.front).toBe(1.0);
      expect(BEAM_PRESETS.meeting.polarWeights.back).toBe(1.0);
      expect(BEAM_PRESETS.meeting.polarWeights.left).toBe(0.0);

      expect(BEAM_PRESETS.omnidirectional.name).toBe("Ambient Off");
      expect(BEAM_PRESETS.omnidirectional.description).toBe(
        "omnidirectional raw audio",
      );
      expect(BEAM_PRESETS.omnidirectional.polarPattern).toBe("omnidirectional");
      expect(BEAM_PRESETS.omnidirectional.polarWeights.front).toBe(1.0);
      expect(BEAM_PRESETS.omnidirectional.polarWeights.back).toBe(1.0);
      expect(BEAM_PRESETS.omnidirectional.polarWeights.left).toBe(1.0);
    });

    it("defaults to omnidirectional preset and allows custom initial preset", () => {
      const defaultManager = new PrivacyZoneManager("user-default");
      expect(defaultManager.getBeamPreset()).toBe("omnidirectional");

      const narrowManager = new PrivacyZoneManager(
        "user-narrow",
        2.0,
        null,
        "narrow",
      );
      expect(narrowManager.getBeamPreset()).toBe("narrow");
    });

    it("reconfigures filter weight matrix when switching presets", () => {
      const manager = new PrivacyZoneManager("user-1");

      // Initially omnidirectional
      expect(manager.getFilterWeightMatrix()).toEqual(
        BEAM_PRESETS.omnidirectional.filterWeightMatrix,
      );

      // Switch to Narrow Focus (cardioid)
      const narrowConfig = manager.setBeamPreset("narrow");
      expect(manager.getBeamPreset()).toBe("narrow");
      expect(narrowConfig.name).toBe("Narrow Focus");
      expect(manager.getFilterWeightMatrix()).toEqual(
        BEAM_PRESETS.narrow.filterWeightMatrix,
      );
      expect(manager.getPolarWeights()).toEqual(
        BEAM_PRESETS.narrow.polarWeights,
      );

      // Switch to Meeting Mode (bilateral)
      const meetingConfig = manager.setBeamPreset("meeting");
      expect(manager.getBeamPreset()).toBe("meeting");
      expect(meetingConfig.name).toBe("Meeting Mode");
      expect(manager.getFilterWeightMatrix()).toEqual(
        BEAM_PRESETS.meeting.filterWeightMatrix,
      );
      expect(manager.getPolarWeights()).toEqual(
        BEAM_PRESETS.meeting.polarWeights,
      );

      // Switch back to Ambient Off (omnidirectional)
      const omniConfig = manager.setBeamPreset("omnidirectional");
      expect(manager.getBeamPreset()).toBe("omnidirectional");
      expect(omniConfig.name).toBe("Ambient Off");
      expect(manager.getFilterWeightMatrix()).toEqual(
        BEAM_PRESETS.omnidirectional.filterWeightMatrix,
      );
    });

    it("ensures filter weight matrix is cloned and protected from external mutation", () => {
      const manager = new PrivacyZoneManager("user-1");
      manager.setBeamPreset("narrow");

      const matrix = manager.getFilterWeightMatrix();
      matrix[0][0] = 999.0;

      expect(manager.getFilterWeightMatrix()[0][0]).toBe(1.0);
    });

    it("throws an error when an invalid preset is passed", () => {
      const manager = new PrivacyZoneManager("user-1");
      expect(() => {
        // @ts-expect-error testing runtime validation
        manager.setBeamPreset("invalid_preset");
      }).toThrow(/Unknown beamforming preset/);
    });

    it("computes directional beam gains according to active polar pattern", () => {
      const manager = new PrivacyZoneManager("user-1");

      // Omnidirectional: uniform gain
      manager.setBeamPreset("omnidirectional");
      expect(manager.calculateBeamGain(0)).toBe(1.0);
      expect(manager.calculateBeamGain(Math.PI / 2)).toBe(1.0);
      expect(manager.calculateBeamGain(Math.PI)).toBe(1.0);

      // Narrow Focus (cardioid): front=1.0, side=0.5, rear=0.0
      manager.setBeamPreset("narrow");
      expect(manager.calculateBeamGain(0)).toBeCloseTo(1.0, 3);
      expect(manager.calculateBeamGain(Math.PI / 2)).toBeCloseTo(0.5, 3);
      expect(manager.calculateBeamGain(Math.PI)).toBeCloseTo(0.0, 3);

      // Meeting Mode (bilateral): front=1.0, rear=1.0, sides=0.0
      manager.setBeamPreset("meeting");
      expect(manager.calculateBeamGain(0)).toBeCloseTo(1.0, 3);
      expect(manager.calculateBeamGain(Math.PI)).toBeCloseTo(1.0, 3);
      expect(manager.calculateBeamGain(Math.PI / 2)).toBeCloseTo(0.0, 3);
    });
  });
});
