import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  SpatialAudioStage,
  stageToAudioCoordinates,
  updatePannerCoordinates,
  updateListenerCoordinates,
  type PeerAvatar,
} from "@/components/spatial/SpatialAudioStage";

describe("SpatialAudioStage Component (#5813)", () => {
  let mockContext: any;
  let mockPannerNode: any;
  let mockGainNode: any;
  let mockSourceNode: any;
  let mockDestination: any;
  let mockListener: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPannerNode = {
      panningModel: "equalpower",
      distanceModel: "linear",
      refDistance: 1,
      maxDistance: 100,
      rolloffFactor: 1,
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      connect: jest.fn(),
      disconnect: jest.fn(),
      setPosition: jest.fn(),
    };

    mockGainNode = {
      gain: { value: 1.0 },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockSourceNode = {
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockDestination = {};

    mockListener = {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      setPosition: jest.fn(),
    };

    mockContext = {
      state: "running",
      currentTime: 10,
      destination: mockDestination,
      listener: mockListener,
      createMediaStreamSource: jest.fn().mockReturnValue(mockSourceNode),
      createGain: jest.fn().mockReturnValue(mockGainNode),
      createPanner: jest.fn().mockReturnValue(mockPannerNode),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      resume: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };

    // Global PannerNode mock
    (globalThis as any).PannerNode = jest
      .fn()
      .mockImplementation((_ctx, opts) => {
        if (opts) {
          if (opts.panningModel)
            mockPannerNode.panningModel = opts.panningModel;
          if (opts.distanceModel)
            mockPannerNode.distanceModel = opts.distanceModel;
          if (opts.refDistance !== undefined)
            mockPannerNode.refDistance = opts.refDistance;
          if (opts.maxDistance !== undefined)
            mockPannerNode.maxDistance = opts.maxDistance;
          if (opts.rolloffFactor !== undefined)
            mockPannerNode.rolloffFactor = opts.rolloffFactor;
        }
        return mockPannerNode;
      });

    (globalThis as any).AudioContext = jest
      .fn()
      .mockImplementation(() => mockContext);
  });

  describe("stageToAudioCoordinates helper", () => {
    it("maps 2D stage coordinates to xz plane by default", () => {
      const coords = stageToAudioCoordinates({ x: 200, y: 150 }, 0.05, "xz");
      expect(coords.x).toBeCloseTo(10);
      expect(coords.y).toBe(0);
      expect(coords.z).toBeCloseTo(7.5);
    });

    it("maps 2D stage coordinates to xy plane when specified", () => {
      const coords = stageToAudioCoordinates({ x: 100, y: 80 }, 0.1, "xy");
      expect(coords.x).toBeCloseTo(10);
      expect(coords.y).toBeCloseTo(8);
      expect(coords.z).toBe(0);
    });

    it("respects explicit 3D z coordinate", () => {
      const coords = stageToAudioCoordinates({ x: 10, y: 5, z: 2 }, 1.0);
      expect(coords.x).toBe(10);
      expect(coords.y).toBe(5);
      expect(coords.z).toBe(2);
    });
  });

  describe("updatePannerCoordinates and updateListenerCoordinates", () => {
    it("updates AudioParam value if available", () => {
      const panner = {
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
      } as any;
      updatePannerCoordinates(panner, 3, 4, 5);
      expect(panner.positionX.value).toBe(3);
      expect(panner.positionY.value).toBe(4);
      expect(panner.positionZ.value).toBe(5);
    });

    it("falls back to setPosition if AudioParam value is not an object", () => {
      const setPosition = jest.fn();
      const panner = { setPosition } as any;
      updatePannerCoordinates(panner, 1, 2, 3);
      expect(setPosition).toHaveBeenCalledWith(1, 2, 3);
    });

    it("updates AudioListener coordinates", () => {
      const listener = {
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
      } as any;
      updateListenerCoordinates(listener, 8, 9, 10);
      expect(listener.positionX.value).toBe(8);
      expect(listener.positionY.value).toBe(9);
      expect(listener.positionZ.value).toBe(10);
    });
  });

  describe("SpatialAudioStage component rendering & Web Audio wiring", () => {
    const mockStream = { id: "stream-peer-1" } as unknown as MediaStream;
    const testPeers: PeerAvatar[] = [
      {
        id: "peer-alex",
        name: "Alex",
        position: { x: 150, y: 100 },
        audioStream: mockStream,
        color: "#3b82f6",
      },
    ];

    it("renders stage canvas, badges, and avatars", () => {
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          initialPeers={testPeers}
          rolloffFactor={1.5}
        />,
      );

      expect(screen.getByTestId("spatial-audio-stage")).toBeInTheDocument();
      expect(screen.getByTestId("stage-canvas")).toBeInTheDocument();
      expect(screen.getByTestId("panning-model-badge")).toHaveTextContent(
        "HRTF 3D Panner",
      );
      expect(screen.getByTestId("distance-model-badge")).toHaveTextContent(
        "Inverse Attenuation",
      );
      expect(screen.getByTestId("avatar-local")).toBeInTheDocument();
      expect(screen.getByTestId("avatar-peer-alex")).toBeInTheDocument();
      expect(screen.getByText("Alex")).toBeInTheDocument();
    });

    it("instantiates PannerNode with HRTF panning model and inverse distance attenuation", () => {
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          peers={testPeers}
          rolloffFactor={2.0}
        />,
      );

      // Verify PannerNode properties
      expect(mockPannerNode.panningModel).toBe("HRTF");
      expect(mockPannerNode.distanceModel).toBe("inverse");
      expect(mockPannerNode.rolloffFactor).toBe(2.0);

      // Verify connection chain: source -> panner -> gain -> destination
      expect(mockContext.createMediaStreamSource).toHaveBeenCalledWith(
        mockStream,
      );
      expect(mockSourceNode.connect).toHaveBeenCalledWith(mockPannerNode);
      expect(mockPannerNode.connect).toHaveBeenCalledWith(mockGainNode);
      expect(mockGainNode.connect).toHaveBeenCalledWith(mockDestination);
    });

    it("dynamically updates panner coordinates when peer avatar moves", () => {
      const onPeerMove = jest.fn();
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          peers={testPeers}
          coordinateScale={0.1}
          coordinateMapping="xz"
          onPeerMove={onPeerMove}
        />,
      );

      // Initially at (150, 100) -> audio coords: x = 15, y = 0, z = 10
      expect(mockPannerNode.positionX.value).toBeCloseTo(15);
      expect(mockPannerNode.positionY.value).toBe(0);
      expect(mockPannerNode.positionZ.value).toBeCloseTo(10);

      // Simulate dragging peer avatar
      const canvas = screen.getByTestId("stage-canvas");
      const peerAvatar = screen.getByTestId("avatar-peer-alex");

      // Mock getBoundingClientRect for stage
      jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        right: 600,
        bottom: 400,
        width: 600,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Pointer down on peer avatar
      fireEvent(
        peerAvatar,
        new MouseEvent("pointerdown", {
          clientX: 150,
          clientY: 100,
          bubbles: true,
        }),
      );

      // Pointer move to (250, 300)
      fireEvent(
        canvas,
        new MouseEvent("pointermove", {
          clientX: 250,
          clientY: 300,
          bubbles: true,
        }),
      );

      // Coordinates should be updated dynamically on PannerNode
      // At x = 250 * 0.1 = 25, z = 300 * 0.1 = 30
      expect(mockPannerNode.positionX.value).toBeCloseTo(25);
      expect(mockPannerNode.positionZ.value).toBeCloseTo(30);
      expect(onPeerMove).toHaveBeenCalledWith(
        "peer-alex",
        expect.objectContaining({ x: 250, y: 300 }),
      );
    });

    it("adjusts rolloff factor on panner when slider value changes", () => {
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          peers={testPeers}
          rolloffFactor={1.0}
        />,
      );

      const slider = screen.getByTestId("rolloff-slider");
      const valueLabel = screen.getByTestId("rolloff-value");

      expect(valueLabel).toHaveTextContent("1.0x");

      fireEvent.change(slider, { target: { value: "2.5" } });

      expect(valueLabel).toHaveTextContent("2.5x");
      expect(mockPannerNode.rolloffFactor).toBe(2.5);
    });

    it("calculates distance in meters between local user and peer", () => {
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          localUser={{
            id: "local-user",
            name: "Host",
            position: { x: 100, y: 100 },
          }}
          peers={[
            {
              id: "peer-alex",
              name: "Alex",
              position: { x: 100, y: 160 }, // 60px distance
              audioStream: mockStream,
            },
          ]}
          coordinateScale={0.05} // 60px * 0.05 = 3.0m
        />,
      );

      expect(screen.getByTestId("peer-distance-peer-alex")).toHaveTextContent(
        "3.0m away",
      );
    });

    it("resumes audio context when user clicks enable button", async () => {
      mockContext.state = "suspended";

      render(
        <SpatialAudioStage audioContext={mockContext} peers={testPeers} />,
      );

      const resumeBtn = screen.getByTestId("resume-audio-btn");
      expect(resumeBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(resumeBtn);
      });

      expect(mockContext.resume).toHaveBeenCalled();
    });

    it("cleans up audio nodes when peer is removed or stage unmounts", () => {
      const { rerender, unmount } = render(
        <SpatialAudioStage audioContext={mockContext} peers={testPeers} />,
      );

      // Rerender with empty peers
      rerender(<SpatialAudioStage audioContext={mockContext} peers={[]} />);

      expect(mockSourceNode.disconnect).toHaveBeenCalled();
      expect(mockPannerNode.disconnect).toHaveBeenCalled();
      expect(mockGainNode.disconnect).toHaveBeenCalled();

      // Unmount should not throw
      unmount();
    });
  });
});
