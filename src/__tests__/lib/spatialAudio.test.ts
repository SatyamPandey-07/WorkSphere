import { SpatialAudioRouter } from "@/lib/spatial/SpatialAudioRouter";
import {
  RemoteListenerInterpolator,
  type SpatialListenerUpdate,
} from "@/lib/spatial/RemoteListenerInterpolator";

describe("SpatialAudioRouter", () => {
  let mockContext: any;
  let mockPannerNode: any;
  let mockGainNode: any;
  let mockSourceNode: any;
  let mockDestination: any;

  beforeEach(() => {
    mockPannerNode = {
      panningModel: "equalpower",
      distanceModel: "linear",
      refDistance: 1,
      maxDistance: 100,
      rolloffFactor: 1,
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      orientationX: { value: 0 },
      orientationY: { value: 0 },
      orientationZ: { value: 0 },
      coneInnerAngle: 360,
      coneOuterAngle: 0,
      coneOuterGain: 0,
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockGainNode = {
      gain: { value: 1.0, setTargetAtTime: jest.fn() },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockSourceNode = {
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockDestination = {};

    mockContext = {
      currentTime: 10,
      destination: mockDestination,
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
      createMediaStreamSource: jest.fn().mockReturnValue(mockSourceNode),
      createGain: jest.fn().mockReturnValue(mockGainNode),
    };

    // Global PannerNode constructor mock
    global.PannerNode = jest.fn().mockImplementation((ctx, opts) => {
      if (opts) {
        if (opts.panningModel) mockPannerNode.panningModel = opts.panningModel;
        if (opts.distanceModel)
          mockPannerNode.distanceModel = opts.distanceModel;
        if (opts.refDistance !== undefined)
          mockPannerNode.refDistance = opts.refDistance;
        if (opts.maxDistance !== undefined)
          mockPannerNode.maxDistance = opts.maxDistance;
        if (opts.rolloffFactor !== undefined)
          mockPannerNode.rolloffFactor = opts.rolloffFactor;
        if (opts.coneInnerAngle !== undefined)
          mockPannerNode.coneInnerAngle = opts.coneInnerAngle;
      }
      return mockPannerNode;
    }) as any;
  });

  it("updates listener position and orientation", () => {
    const router = new SpatialAudioRouter(mockContext as any);

    router.updateListenerPosition(10, 2, -5);
    expect(mockContext.listener.positionX.value).toBe(10);
    expect(mockContext.listener.positionY.value).toBe(2);
    expect(mockContext.listener.positionZ.value).toBe(-5);

    router.updateListenerOrientation(0, 0, 1, 0, 1, 0);
    expect(mockContext.listener.forwardX.value).toBe(0);
    expect(mockContext.listener.forwardY.value).toBe(0);
    expect(mockContext.listener.forwardZ.value).toBe(1);
  });

  it("attaches remote WebRTC track with HRTF panner node and inverse distance model", () => {
    const router = new SpatialAudioRouter(mockContext as any);
    const mockStream = {} as MediaStream;

    const chain = router.attachRemoteTrack("peer-1", mockStream);

    expect(mockContext.createMediaStreamSource).toHaveBeenCalledWith(
      mockStream,
    );
    expect(global.PannerNode).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        panningModel: "HRTF",
        distanceModel: "inverse",
        refDistance: 1.0,
        maxDistance: 50.0,
        rolloffFactor: 1.0,
        coneInnerAngle: 360,
      }),
    );

    expect(mockSourceNode.connect).toHaveBeenCalledWith(mockGainNode);
    expect(mockGainNode.connect).toHaveBeenCalledWith(mockPannerNode);
    expect(mockPannerNode.connect).toHaveBeenCalledWith(mockDestination);
    expect(chain.peerId).toBe("peer-1");
  });

  it("updates peer 3D position and volume", () => {
    const router = new SpatialAudioRouter(mockContext as any);
    const mockStream = {} as MediaStream;

    router.attachRemoteTrack("peer-1", mockStream);
    router.updatePeerPosition("peer-1", 4, 1.5, 8);

    expect(mockPannerNode.positionX.value).toBe(4);
    expect(mockPannerNode.positionY.value).toBe(1.5);
    expect(mockPannerNode.positionZ.value).toBe(8);

    router.setPeerVolume("peer-1", 0.8);
    expect(mockGainNode.gain.setTargetAtTime).toHaveBeenCalledWith(
      0.8,
      10,
      0.05,
    );
  });

  it("detaches peer and cleans up audio nodes", () => {
    const router = new SpatialAudioRouter(mockContext as any);
    const mockStream = {} as MediaStream;

    router.attachRemoteTrack("peer-1", mockStream);
    expect(router.getChain("peer-1")).toBeDefined();

    router.detachPeer("peer-1");
    expect(mockSourceNode.disconnect).toHaveBeenCalled();
    expect(mockGainNode.disconnect).toHaveBeenCalled();
    expect(mockPannerNode.disconnect).toHaveBeenCalled();
    expect(router.getChain("peer-1")).toBeUndefined();
  });
});

describe("RemoteListenerInterpolator", () => {
  let mockRouter: any;

  beforeEach(() => {
    mockRouter = {
      updatePeerPosition: jest.fn(),
      updatePeerOrientation: jest.fn(),
    };
  });

  it("applies updates directly to router and maintains ring buffer", () => {
    const interpolator = new RemoteListenerInterpolator(2);

    const update1: SpatialListenerUpdate = {
      type: "spatial_listener_update",
      userId: "user-1",
      position: { x: 1, y: 0, z: 2 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
      timestamp: 100,
    };

    interpolator.applyUpdate(update1, mockRouter);
    expect(mockRouter.updatePeerPosition).toHaveBeenCalledWith(
      "user-1",
      1,
      0,
      2,
    );
    expect(mockRouter.updatePeerOrientation).toHaveBeenCalledWith(
      "user-1",
      0,
      0,
      -1,
    );

    const history = interpolator.getHistory("user-1");
    expect(history).toHaveLength(1);
  });

  it("interpolates position linearly between timestamps", () => {
    const interpolator = new RemoteListenerInterpolator(4);

    const update1: SpatialListenerUpdate = {
      type: "spatial_listener_update",
      userId: "user-1",
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
      timestamp: 1000,
    };

    const update2: SpatialListenerUpdate = {
      type: "spatial_listener_update",
      userId: "user-1",
      position: { x: 10, y: 0, z: 20 },
      forward: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
      timestamp: 2000,
    };

    interpolator.applyUpdate(update1, mockRouter);
    interpolator.applyUpdate(update2, mockRouter);

    const mid = interpolator.interpolate("user-1", 1500);
    expect(mid?.position).toEqual({ x: 5, y: 0, z: 10 });
  });

  it("registers window resize listener on setup and removes it on dispose", () => {
    const addSpy = jest.spyOn(window, "addEventListener");
    const removeSpy = jest.spyOn(window, "removeEventListener");

    const interpolator = new RemoteListenerInterpolator();
    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    interpolator.dispose();
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
