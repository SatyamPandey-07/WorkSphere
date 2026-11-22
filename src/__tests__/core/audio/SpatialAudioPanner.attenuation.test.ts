import {
  SpatialAudioPanner,
  DEFAULT_SPATIAL_PANNER_DISTANCE_CONFIG,
} from "@/core/audio/SpatialAudioPanner";

describe("Spatial Audio Proximity Attenuation (#7570)", () => {
  let mockAudioContext: any;
  let mockDestination: any;
  let mockMasterGain: any;
  let mockListener: any;
  let createdPannerNodes: any[];
  let createdGainNodes: any[];

  beforeEach(() => {
    createdPannerNodes = [];
    createdGainNodes = [];
    mockDestination = {};
    mockMasterGain = {
      gain: {
        value: 1.0,
        setValueAtTime: jest.fn(),
      },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

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

    mockAudioContext = {
      currentTime: 10,
      destination: mockDestination,
      listener: mockListener,
      createGain: jest.fn(() => {
        const gainNode = {
          gain: {
            value: 1.0,
            setValueAtTime: jest.fn(function (val: number) {
              gainNode.gain.value = val;
            }),
          },
          connect: jest.fn(),
          disconnect: jest.fn(),
        };
        createdGainNodes.push(gainNode);
        return gainNode;
      }),
      createPanner: jest.fn(() => {
        const panner = {
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
        createdPannerNodes.push(panner);
        return panner;
      }),
      createMediaStreamSource: jest.fn(() => ({
        connect: jest.fn(),
        disconnect: jest.fn(),
      })),
    };
  });

  it("applies the exact inverse distance configuration required by Issue #7570", () => {
    const pannerManager = new SpatialAudioPanner(
      mockAudioContext,
      "inverse",
      { enabled: false },
      {
        distanceModel: "inverse",
        refDistance: 100,
        maxDistance: 1000,
        rolloffFactor: 1.5,
      }
    );

    const config = pannerManager.getDistanceConfig();
    expect(config.distanceModel).toBe("inverse");
    expect(config.refDistance).toBe(100);
    expect(config.maxDistance).toBe(1000);
    expect(config.rolloffFactor).toBe(1.5);
  });

  it("attenuates remote voice gain as participant moves farther away", () => {
    const pannerManager = new SpatialAudioPanner(
      mockAudioContext,
      "inverse",
      { enabled: false },
      {
        distanceModel: "inverse",
        refDistance: 100,
        maxDistance: 1000,
        rolloffFactor: 1.5,
      }
    );

    // Listener at (0, 0, 0)
    pannerManager.updateListenerPosition(0, 0, 0, 0, 0, -1);

    // At distance <= refDistance (100m): attenuation should be 1.0 (full volume)
    const gainAtRef = pannerManager.calculateDistanceAttenuation({ x: 50, y: 0, z: 0 });
    expect(gainAtRef).toBe(1.0);

    const gainAt100 = pannerManager.calculateDistanceAttenuation({ x: 100, y: 0, z: 0 });
    expect(gainAt100).toBe(1.0);

    // At distance 200m:
    // gain = refDistance / (refDistance + rolloffFactor * (distance - refDistance))
    // gain = 100 / (100 + 1.5 * (200 - 100)) = 100 / (100 + 150) = 100 / 250 = 0.4
    const gainAt200 = pannerManager.calculateDistanceAttenuation({ x: 200, y: 0, z: 0 });
    expect(gainAt200).toBeCloseTo(0.4, 4);

    // At distance 500m:
    // gain = 100 / (100 + 1.5 * (500 - 100)) = 100 / (100 + 600) = 100 / 700 = 0.142857
    const gainAt500 = pannerManager.calculateDistanceAttenuation({ x: 500, y: 0, z: 0 });
    expect(gainAt500).toBeCloseTo(0.142857, 4);

    // Voice is strictly quieter as distance increases
    expect(gainAt500).toBeLessThan(gainAt200);
    expect(gainAt200).toBeLessThan(gainAtRef);
  });

  it("creates PannerNode on peer join and cleans it up immediately on removePeer / destroy", () => {
    const pannerManager = new SpatialAudioPanner(
      mockAudioContext,
      "inverse",
      { enabled: false },
      {
        distanceModel: "inverse",
        refDistance: 100,
        maxDistance: 1000,
        rolloffFactor: 1.5,
      }
    );

    const mockStream = {} as MediaStream;
    pannerManager.addPeer("peer-alex", mockStream);

    expect(createdPannerNodes.length).toBe(1);
    const peerPanner = createdPannerNodes[0];
    expect(peerPanner.distanceModel).toBe("inverse");
    expect(peerPanner.refDistance).toBe(100);
    expect(peerPanner.maxDistance).toBe(1000);
    expect(peerPanner.rolloffFactor).toBe(1.5);

    // Moving peer updates positionX/Y/Z and gain
    pannerManager.updatePeerPosition("peer-alex", 300, 400, 0);
    expect(peerPanner.positionX.value).toBe(300);
    expect(peerPanner.positionY.value).toBe(400);
    expect(peerPanner.positionZ.value).toBe(0);

    // Disconnecting peer removes node immediately
    pannerManager.removePeer("peer-alex");
    expect(peerPanner.disconnect).toHaveBeenCalled();
  });
});
