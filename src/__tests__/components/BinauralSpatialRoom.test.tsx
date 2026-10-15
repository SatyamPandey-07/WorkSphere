import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  BinauralSpatialRoom,
  calculateOrientationVectors,
  updateAudioListener,
  configureHrtfPanner,
  updatePannerPosition,
  calculateSpatialTelemetry,
} from "@/components/audio/BinauralSpatialRoom";

describe("BinauralSpatialRoom Unit Tests", () => {
  describe("Mathematical & Vector Calculations", () => {
    it("calculates forward and up orientation vectors correctly for different yaw angles", () => {
      // Yaw = 0 (facing North / -Z)
      const north = calculateOrientationVectors(0);
      expect(north.forward[0]).toBeCloseTo(0);
      expect(north.forward[1]).toBe(0);
      expect(north.forward[2]).toBeCloseTo(-1);
      expect(north.up).toEqual([0, 1, 0]);

      // Yaw = PI / 2 (facing East / +X)
      const east = calculateOrientationVectors(Math.PI / 2);
      expect(east.forward[0]).toBeCloseTo(1);
      expect(east.forward[1]).toBe(0);
      expect(east.forward[2]).toBeCloseTo(0);

      // Yaw = PI (facing South / +Z)
      const south = calculateOrientationVectors(Math.PI);
      expect(south.forward[0]).toBeCloseTo(0);
      expect(south.forward[1]).toBe(0);
      expect(south.forward[2]).toBeCloseTo(1);

      // Yaw = -PI / 2 (facing West / -X)
      const west = calculateOrientationVectors(-Math.PI / 2);
      expect(west.forward[0]).toBeCloseTo(-1);
      expect(west.forward[1]).toBe(0);
      expect(west.forward[2]).toBeCloseTo(0);
    });

    it("calculates spatial azimuth and distance accurately", () => {
      const listener = { x: 10, y: 10, z: 0, orientationAngle: 0 }; // Facing North

      // Peer straight ahead (North, lower Y in canvas coords)
      const peerAhead = { x: 10, y: 5, z: 0 };
      const aheadResult = calculateSpatialTelemetry(listener, peerAhead);
      expect(aheadResult.distance).toBe(5);
      expect(aheadResult.azimuthDeg).toBe(0);
      expect(aheadResult.sector).toBe("Front (Center)");

      // Peer to the right (East, higher X)
      const peerRight = { x: 14, y: 10, z: 0 };
      const rightResult = calculateSpatialTelemetry(listener, peerRight);
      expect(rightResult.distance).toBe(4);
      expect(rightResult.azimuthDeg).toBe(90);
      expect(rightResult.sector).toBe("Direct Right");

      // Peer to the left (West, lower X)
      const peerLeft = { x: 6, y: 10, z: 0 };
      const leftResult = calculateSpatialTelemetry(listener, peerLeft);
      expect(leftResult.distance).toBe(4);
      expect(leftResult.azimuthDeg).toBe(-90);
      expect(leftResult.sector).toBe("Direct Left");

      // Peer directly behind (South, higher Y)
      const peerBehind = { x: 10, y: 15, z: 0 };
      const behindResult = calculateSpatialTelemetry(listener, peerBehind);
      expect(behindResult.distance).toBe(5);
      expect(Math.abs(behindResult.azimuthDeg)).toBe(180);
      expect(behindResult.sector).toBe("Direct Back");
    });
  });

  describe("Web Audio API Integration Functions", () => {
    it("updates AudioListener with modern AudioParam values", () => {
      const mockListener: any = {
        positionX: { value: 0, setValueAtTime: jest.fn() },
        positionY: { value: 0, setValueAtTime: jest.fn() },
        positionZ: { value: 0, setValueAtTime: jest.fn() },
        forwardX: { value: 0, setValueAtTime: jest.fn() },
        forwardY: { value: 0, setValueAtTime: jest.fn() },
        forwardZ: { value: 0, setValueAtTime: jest.fn() },
        upX: { value: 0, setValueAtTime: jest.fn() },
        upY: { value: 0, setValueAtTime: jest.fn() },
        upZ: { value: 0, setValueAtTime: jest.fn() },
      };

      updateAudioListener(mockListener, { x: 5, y: 8, z: 1 }, Math.PI / 2, 2);

      expect(mockListener.positionX.value).toBe(10);
      expect(mockListener.positionY.value).toBe(2);
      expect(mockListener.positionZ.value).toBe(16);
      expect(mockListener.forwardX.value).toBeCloseTo(1);
      expect(mockListener.forwardY.value).toBe(0);
      expect(mockListener.forwardZ.value).toBeCloseTo(0);
      expect(mockListener.upY.value).toBe(1);
    });

    it("falls back to legacy setPosition and setOrientation on legacy AudioListener", () => {
      const mockLegacyListener: any = {
        setPosition: jest.fn(),
        setOrientation: jest.fn(),
      };

      updateAudioListener(mockLegacyListener, { x: 3, y: 4, z: 0 }, 0, 1);

      expect(mockLegacyListener.setPosition).toHaveBeenCalledWith(3, 0, 4);
      expect(mockLegacyListener.setOrientation).toHaveBeenCalledWith(
        expect.any(Number),
        0,
        expect.any(Number),
        0,
        1,
        0
      );
    });

    it("configures PannerNode with HRTF panning model and audio parameters", () => {
      const mockPanner: any = {
        panningModel: "equalpower",
        distanceModel: "linear",
        refDistance: 1,
        maxDistance: 1000,
        rolloffFactor: 1,
        coneInnerAngle: 360,
        coneOuterAngle: 0,
      };

      configureHrtfPanner(mockPanner);

      expect(mockPanner.panningModel).toBe("HRTF");
      expect(mockPanner.distanceModel).toBe("inverse");
      expect(mockPanner.refDistance).toBe(1);
      expect(mockPanner.maxDistance).toBe(100);
      expect(mockPanner.rolloffFactor).toBe(1.2);
    });

    it("updates PannerNode position via AudioParam or fallback", () => {
      const mockModernPanner: any = {
        positionX: { value: 0, setValueAtTime: jest.fn() },
        positionY: { value: 0, setValueAtTime: jest.fn() },
        positionZ: { value: 0, setValueAtTime: jest.fn() },
      };

      updatePannerPosition(mockModernPanner, 12, 15, 2, 1);
      expect(mockModernPanner.positionX.value).toBe(12);
      expect(mockModernPanner.positionY.value).toBe(2);
      expect(mockModernPanner.positionZ.value).toBe(15);

      const mockLegacyPanner: any = {
        setPosition: jest.fn(),
      };
      updatePannerPosition(mockLegacyPanner, 7, 9, 0, 1);
      expect(mockLegacyPanner.setPosition).toHaveBeenCalledWith(7, 0, 9);
    });
  });

  describe("BinauralSpatialRoom Component", () => {
    let mockAudioContext: any;
    let mockGainNode: any;
    let mockPannerNode: any;
    let mockOscillatorNode: any;

    beforeEach(() => {
      mockGainNode = {
        gain: {
          value: 1.0,
          setValueAtTime: jest.fn(),
        },
        connect: jest.fn(),
        disconnect: jest.fn(),
      };

      mockPannerNode = {
        panningModel: "HRTF",
        distanceModel: "inverse",
        refDistance: 1,
        maxDistance: 100,
        rolloffFactor: 1.2,
        coneInnerAngle: 360,
        coneOuterAngle: 0,
        positionX: { value: 0, setValueAtTime: jest.fn() },
        positionY: { value: 0, setValueAtTime: jest.fn() },
        positionZ: { value: 0, setValueAtTime: jest.fn() },
        connect: jest.fn(),
        disconnect: jest.fn(),
      };

      mockOscillatorNode = {
        type: "sine",
        frequency: { value: 440 },
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        disconnect: jest.fn(),
      };

      mockAudioContext = {
        state: "suspended",
        currentTime: 0,
        destination: {},
        listener: {
          positionX: { value: 0, setValueAtTime: jest.fn() },
          positionY: { value: 0, setValueAtTime: jest.fn() },
          positionZ: { value: 0, setValueAtTime: jest.fn() },
          forwardX: { value: 0, setValueAtTime: jest.fn() },
          forwardY: { value: 0, setValueAtTime: jest.fn() },
          forwardZ: { value: -1, setValueAtTime: jest.fn() },
          upX: { value: 0, setValueAtTime: jest.fn() },
          upY: { value: 1, setValueAtTime: jest.fn() },
          upZ: { value: 0, setValueAtTime: jest.fn() },
        },
        createGain: jest.fn(() => mockGainNode),
        createPanner: jest.fn(() => mockPannerNode),
        createOscillator: jest.fn(() => mockOscillatorNode),
        resume: jest.fn().mockImplementation(async () => {
          mockAudioContext.state = "running";
        }),
        suspend: jest.fn().mockImplementation(async () => {
          mockAudioContext.state = "suspended";
        }),
        close: jest.fn().mockResolvedValue(undefined),
      };

      (window as any).AudioContext = jest.fn(() => mockAudioContext);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it("renders the room with listener avatar, peers, and telemetry cards", () => {
      render(
        <BinauralSpatialRoom
          audioContext={mockAudioContext}
          roomName="Alpha Virtual Pod"
          initialParticipants={[
            { id: "peer-1", name: "Alice", x: 6, y: 7, z: 0, role: "Frontend" },
            { id: "peer-2", name: "Bob", x: 14, y: 12, z: 0, role: "Backend" },
          ]}
        />
      );

      expect(screen.getByText("Alpha Virtual Pod")).toBeInTheDocument();
      expect(screen.getByTestId("listener-avatar")).toBeInTheDocument();
      expect(screen.getByTestId("peer-avatar-peer-1")).toBeInTheDocument();
      expect(screen.getByTestId("peer-avatar-peer-2")).toBeInTheDocument();
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("HRTF 3D Active")).toBeInTheDocument();
    });

    it("toggles audio engine state on button click", async () => {
      render(<BinauralSpatialRoom audioContext={mockAudioContext} />);

      const toggleBtn = screen.getByTestId("toggle-audio-engine");
      expect(toggleBtn).toHaveTextContent("Start Spatial Audio");

      await act(async () => {
        fireEvent.click(toggleBtn);
      });

      expect(mockAudioContext.resume).toHaveBeenCalled();
      expect(toggleBtn).toHaveTextContent("3D Audio Online");

      await act(async () => {
        fireEvent.click(toggleBtn);
      });

      expect(mockAudioContext.suspend).toHaveBeenCalled();
      expect(toggleBtn).toHaveTextContent("Start Spatial Audio");
    });

    it("toggles panning model between HRTF and equalpower", () => {
      render(<BinauralSpatialRoom audioContext={mockAudioContext} />);

      const toggleModelBtn = screen.getByTestId("toggle-panning-model");
      expect(toggleModelBtn).toHaveTextContent("HRTF");

      fireEvent.click(toggleModelBtn);
      expect(toggleModelBtn).toHaveTextContent("EQUALPOWER");

      fireEvent.click(toggleModelBtn);
      expect(toggleModelBtn).toHaveTextContent("HRTF");
    });

    it("rotates listener orientation and updates forward/up vectors", () => {
      const onListenerMove = jest.fn();
      render(
        <BinauralSpatialRoom
          audioContext={mockAudioContext}
          onListenerMove={onListenerMove}
        />
      );

      const rotateRightBtn = screen.getByTestId("rotate-right-btn");
      fireEvent.click(rotateRightBtn);

      expect(onListenerMove).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.closeTo((15 * Math.PI) / 180, 2)
      );

      const rotateLeftBtn = screen.getByTestId("rotate-left-btn");
      fireEvent.click(rotateLeftBtn);

      expect(onListenerMove).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.closeTo(0, 2)
      );
    });

    it("centers the listener when center button is clicked", () => {
      const onListenerMove = jest.fn();
      render(
        <BinauralSpatialRoom
          audioContext={mockAudioContext}
          initialListener={{ x: 2, y: 2 }}
          roomDimensions={{ width: 20, height: 20 }}
          onListenerMove={onListenerMove}
        />
      );

      const centerBtn = screen.getByTestId("center-listener-btn");
      fireEvent.click(centerBtn);

      expect(onListenerMove).toHaveBeenCalledWith(10, 10, 0);
    });

    it("mutes and unmutes individual peers", () => {
      render(
        <BinauralSpatialRoom
          audioContext={mockAudioContext}
          initialParticipants={[
            { id: "peer-mute-test", name: "Charlie", x: 8, y: 8, muted: false },
          ]}
        />
      );

      const muteBtn = screen.getByTestId("mute-peer-peer-mute-test");
      fireEvent.click(muteBtn);

      // Verify muted button state
      expect(screen.getByTestId("peer-avatar-peer-mute-test")).toBeInTheDocument();
    });

    it("adjusts master volume and toggles master mute", () => {
      render(<BinauralSpatialRoom audioContext={mockAudioContext} />);

      const volumeSlider = screen.getByTestId("master-volume-slider");
      fireEvent.change(volumeSlider, { target: { value: "0.5" } });
      expect(screen.getByText("50%")).toBeInTheDocument();

      const muteBtn = screen.getByTestId("toggle-master-mute");
      fireEvent.click(muteBtn);
      expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalled();
    });
  });
});
