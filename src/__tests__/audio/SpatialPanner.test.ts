/**
 * SpatialPanner.test.ts
 * Tests configurable Web Audio distance attenuation models (#6478).
 */

import {
  SpatialAudioPanner,
  DEFAULT_SPATIAL_PANNER_DISTANCE_CONFIG,
  SPATIAL_PANNER_DISTANCE_LIMITS,
  sanitizeDistanceConfig,
  type DistanceAttenuationCurve,
} from "@/core/audio/SpatialAudioPanner";

type MockGainNode = {
  gain: { value: number; setValueAtTime: jest.Mock };
  connect: jest.Mock;
  disconnect: jest.Mock;
};

type MockPannerNode = {
  panningModel: string;
  distanceModel: DistanceAttenuationCurve;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  coneInnerAngle: number;
  coneOuterAngle: number;
  coneOuterGain: number;
  positionX: { value: number };
  positionY: { value: number };
  positionZ: { value: number };
  connect: jest.Mock;
  disconnect: jest.Mock;
  setPosition: jest.Mock;
};

function createMockAudioContext() {
  const gainNodes: MockGainNode[] = [];
  const pannerNodes: MockPannerNode[] = [];

  const audioContext: any = {
    currentTime: 12,
    destination: {},
    listener: {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: -1 },
      upX: { value: 0 },
      upY: { value: 1 },
      upZ: { value: 0 },
    },
    createGain: jest.fn(() => {
      const node: MockGainNode = {
        gain: {
          value: 1,
          setValueAtTime: jest.fn((next: number) => {
            node.gain.value = next;
          }),
        },
        connect: jest.fn(),
        disconnect: jest.fn(),
      };
      gainNodes.push(node);
      return node;
    }),
    createPanner: jest.fn(() => {
      const node: MockPannerNode = {
        panningModel: "equalpower",
        distanceModel: "inverse",
        refDistance: 1,
        maxDistance: 100,
        rolloffFactor: 1,
        coneInnerAngle: 360,
        coneOuterAngle: 360,
        coneOuterGain: 0,
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
        connect: jest.fn(),
        disconnect: jest.fn(),
        setPosition: jest.fn(),
      };
      pannerNodes.push(node);
      return node;
    }),
    createMediaStreamSource: jest.fn(() => ({
      connect: jest.fn(),
      disconnect: jest.fn(),
    })),
  };

  return { audioContext, gainNodes, pannerNodes };
}

function createPanner(
  model: DistanceAttenuationCurve = "inverse",
  distanceConfig: Parameters<typeof sanitizeDistanceConfig>[0] = {}
) {
  const mock = createMockAudioContext();
  const panner = new SpatialAudioPanner(
    mock.audioContext,
    model,
    { enabled: false },
    distanceConfig
  );
  return { panner, ...mock };
}

describe("SpatialAudioPanner distance attenuation configuration (#6478)", () => {
  it("uses safe Web Audio defaults for distance attenuation", () => {
    const { panner } = createPanner();

    expect(panner.getDistanceConfig()).toEqual(DEFAULT_SPATIAL_PANNER_DISTANCE_CONFIG);
    expect(panner.getDistanceModel()).toBe("inverse");
    expect(panner.refDistance).toBe(1);
    expect(panner.maxDistance).toBe(100);
    expect(panner.rolloffFactor).toBe(1);
  });

  it("accepts distance options through the constructor", () => {
    const { panner } = createPanner("inverse", {
      distanceModel: "exponential",
      refDistance: 2,
      maxDistance: 64,
      rolloffFactor: 0.5,
    });

    expect(panner.getDistanceConfig()).toEqual({
      distanceModel: "exponential",
      refDistance: 2,
      maxDistance: 64,
      rolloffFactor: 0.5,
    });
  });

  it("computes the inverse distance attenuation curve", () => {
    const { panner } = createPanner("inverse", {
      refDistance: 1,
      maxDistance: 100,
      rolloffFactor: 1,
    });

    // gain = refDistance / (refDistance + rolloffFactor * (distance - refDistance))
    expect(panner.calculateDistanceAttenuation({ x: 10, y: 0, z: 0 })).toBeCloseTo(0.1, 6);
  });

  it("computes the linear distance attenuation curve", () => {
    const { panner } = createPanner("linear", {
      refDistance: 1,
      maxDistance: 11,
      rolloffFactor: 1,
    });

    // gain = 1 - rolloffFactor * (distance - refDistance) / (maxDistance - refDistance)
    expect(panner.calculateDistanceAttenuation({ x: 6, y: 0, z: 0 })).toBeCloseTo(0.5, 6);
  });

  it("computes the exponential distance attenuation curve", () => {
    const { panner } = createPanner("exponential", {
      refDistance: 1,
      maxDistance: 100,
      rolloffFactor: 2,
    });

    // gain = (distance / refDistance) ^ (-rolloffFactor)
    expect(panner.calculateDistanceAttenuation({ x: 3, y: 0, z: 0 })).toBeCloseTo(1 / 9, 6);
  });

  it("clamps distance to maxDistance instead of collapsing to silence", () => {
    const { panner } = createPanner("inverse", {
      refDistance: 1,
      maxDistance: 100,
      rolloffFactor: 1,
    });

    // At the horizon the inverse model keeps a floor of 1 / (1 + 99) = 0.01.
    expect(panner.calculateDistanceAttenuation({ x: 5000, y: 0, z: 0 })).toBeCloseTo(0.01, 6);
  });

  it("clamps configurable values into physically safe Web Audio bounds", () => {
    const { panner } = createPanner();

    const resolved = panner.setDistanceConfig({
      distanceModel: "exponential",
      refDistance: -10,
      maxDistance: -20,
      rolloffFactor: 999,
    });

    expect(resolved.refDistance).toBe(SPATIAL_PANNER_DISTANCE_LIMITS.minRefDistance);
    expect(resolved.rolloffFactor).toBe(SPATIAL_PANNER_DISTANCE_LIMITS.maxRolloffFactor);
    expect(resolved.maxDistance).toBeGreaterThan(resolved.refDistance);
    expect(resolved.distanceModel).toBe("exponential");
  });

  it("falls back to the previous model for invalid distance models", () => {
    const { panner } = createPanner("linear");

    const resolved = panner.setDistanceModel("bogus" as DistanceAttenuationCurve);

    expect(resolved.distanceModel).toBe("linear");
  });

  it("keeps calculated gain within [0, 1] for extreme configurations", () => {
    const { panner } = createPanner("exponential", {
      refDistance: 0.001,
      maxDistance: 1000000,
      rolloffFactor: 10,
    });

    const gain = panner.calculateDistanceAttenuation({ x: 500, y: 0, z: 0 });
    expect(gain).toBeGreaterThanOrEqual(0);
    expect(gain).toBeLessThanOrEqual(1);
  });

  it("applies the active distance config to peer PannerNodes and recalculates gains", () => {
    const { panner, pannerNodes, gainNodes } = createPanner("inverse");

    panner.addPeer("peer-1", {} as MediaStream);

    expect(pannerNodes).toHaveLength(1);
    expect(pannerNodes[0].distanceModel).toBe("inverse");
    expect(pannerNodes[0].refDistance).toBe(1);
    expect(pannerNodes[0].maxDistance).toBe(100);
    expect(pannerNodes[0].rolloffFactor).toBe(1);

    panner.setDistanceConfig({
      distanceModel: "exponential",
      refDistance: 2,
      maxDistance: 64,
      rolloffFactor: 3,
    });

    const peerPanner = pannerNodes[0];
    expect(peerPanner.distanceModel).toBe("exponential");
    expect(peerPanner.refDistance).toBe(2);
    expect(peerPanner.maxDistance).toBe(64);
    expect(peerPanner.rolloffFactor).toBe(3);

    // Master gain is created first, the peer gain node second.
    const peerGain = gainNodes[1];
    expect(peerGain.gain.setValueAtTime).toHaveBeenCalled();
  });
});
