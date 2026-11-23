import React from "react";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { VirtualCoworkingCanvas } from "@/components/cowork/VirtualCoworkingCanvas";
import { SpatialAudioPanner } from "@/core/audio/SpatialAudioPanner";

// Mock SpatialAudioPanner to verify exact config and method calls
jest.mock("@/core/audio/SpatialAudioPanner");

describe("VirtualCoworkingCanvas & Spatial Audio Attenuation (#7570)", () => {
  let mockSocket: {
    send: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
    listeners: Record<string, ((event: any) => void)[]>;
    triggerMessage: (data: any) => void;
  };

  let mockAudioContext: any;
  let mockPannerInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const listeners: Record<string, ((event: any) => void)[]> = {};
    mockSocket = {
      send: jest.fn(),
      addEventListener: jest.fn((type: string, listener: any) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      }),
      removeEventListener: jest.fn((type: string, listener: any) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter((l) => l !== listener);
        }
      }),
      listeners,
      triggerMessage: (data: any) => {
        const event = { data: JSON.stringify(data) };
        (listeners["message"] || []).forEach((fn) => fn(event));
      },
    };

    mockAudioContext = {
      currentTime: 0,
      state: "running",
      destination: {},
      listener: {
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
      },
      close: jest.fn(),
    };

    mockPannerInstance = {
      updatePeerPosition: jest.fn(),
      updateListenerPosition: jest.fn(),
      addPeer: jest.fn(),
      removePeer: jest.fn(),
      destroy: jest.fn(),
    };
    (SpatialAudioPanner as unknown as jest.Mock).mockImplementation(() => mockPannerInstance);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it("configures SpatialAudioPanner with exact inverse distance parameters", () => {
    render(
      <VirtualCoworkingCanvas
        roomId="room-1"
        currentUserId="user-me"
        socket={mockSocket as any}
        audioContext={mockAudioContext}
      />
    );

    expect(SpatialAudioPanner).toHaveBeenCalledTimes(1);
    const constructorCallArgs = (SpatialAudioPanner as unknown as jest.Mock).mock.calls[0];
    const distanceConfig = constructorCallArgs[3];
    expect(distanceConfig).toEqual({
      distanceModel: "inverse",
      refDistance: 100,
      maxDistance: 1000,
      rolloffFactor: 1.5,
    });
  });

  it("renders remote participant cursors upon receiving cursor_pos message", () => {
    const { getByTestId, queryByTestId } = render(
      <VirtualCoworkingCanvas
        roomId="room-1"
        currentUserId="user-me"
        socket={mockSocket as any}
        audioContext={mockAudioContext}
      />
    );

    expect(queryByTestId("remote-cursor-peer-1")).toBeNull();

    act(() => {
      mockSocket.triggerMessage({
        type: "cursor_pos",
        id: "peer-1",
        x: 200,
        y: 150,
        metadata: { name: "Alice", color: "#EC4899" },
      });
    });

    expect(getByTestId("remote-cursor-peer-1")).toBeInTheDocument();
    expect(getByTestId("remote-cursor-label-peer-1").textContent).toBe("Alice");

    // Also verifies spatial audio position update
    expect(mockPannerInstance.updatePeerPosition).toHaveBeenCalledWith("peer-1", 200, 150, 0);
  });

  it("updates remote cursor position and audio upon cursor_delta message", () => {
    const { getByTestId } = render(
      <VirtualCoworkingCanvas
        roomId="room-1"
        currentUserId="user-me"
        socket={mockSocket as any}
        audioContext={mockAudioContext}
      />
    );

    // Initial position
    act(() => {
      mockSocket.triggerMessage({
        type: "cursor_pos",
        id: "peer-2",
        x: 100,
        y: 100,
        metadata: { name: "Bob" },
      });
    });

    // Delta update
    act(() => {
      mockSocket.triggerMessage({
        type: "cursor_delta",
        id: "peer-2",
        dx: 50,
        dy: -30,
      });
    });

    expect(mockPannerInstance.updatePeerPosition).toHaveBeenCalledWith("peer-2", 150, 70, 0);
  });

  it("removes remote cursor and cleans up spatial audio peer on participant_left", () => {
    const { queryByTestId } = render(
      <VirtualCoworkingCanvas
        roomId="room-1"
        currentUserId="user-me"
        socket={mockSocket as any}
        audioContext={mockAudioContext}
      />
    );

    act(() => {
      mockSocket.triggerMessage({
        type: "cursor_pos",
        id: "peer-3",
        x: 120,
        y: 140,
        metadata: { name: "Charlie" },
      });
    });

    expect(queryByTestId("remote-cursor-peer-3")).toBeInTheDocument();

    // Disconnect event
    act(() => {
      mockSocket.triggerMessage({
        type: "participant_left",
        id: "peer-3",
      });
    });

    expect(queryByTestId("remote-cursor-peer-3")).toBeNull();
    expect(mockPannerInstance.removePeer).toHaveBeenCalledWith("peer-3");
  });

  it("throttles local pointer broadcasts to 30Hz", () => {
    const { getByTestId } = render(
      <VirtualCoworkingCanvas
        roomId="room-1"
        currentUserId="user-me"
        userName="Me"
        socket={mockSocket as any}
        audioContext={mockAudioContext}
      />
    );

    const canvas = getByTestId("virtual-coworking-canvas");

    // Advance clock initially
    jest.advanceTimersByTime(100);

    // Fire initial pointer move
    act(() => {
      fireEvent.mouseMove(canvas, {
        clientX: 50,
        clientY: 50,
      });
    });

    expect(mockSocket.send).toHaveBeenCalledTimes(1);

    // Fire rapid subsequent pointer moves within throttle window
    act(() => {
      fireEvent.mouseMove(canvas, {
        clientX: 70,
        clientY: 70,
      });
      fireEvent.mouseMove(canvas, {
        clientX: 120,
        clientY: 120,
      });
    });

    // Still only 1 call because we're inside the throttle window
    expect(mockSocket.send).toHaveBeenCalledTimes(1);

    // Advance fake timers past 35ms (30Hz interval)
    act(() => {
      jest.advanceTimersByTime(50);
    });

    // The throttled event should now be dispatched with the latest position
    expect(mockSocket.send).toHaveBeenCalledTimes(2);
    const secondCallMsg = JSON.parse(mockSocket.send.mock.calls[1][0]);
    expect(secondCallMsg.type).toBe("cursor_delta");
    expect(secondCallMsg.dx).toBe(70);
    expect(secondCallMsg.dy).toBe(70);
  });

  it("cleans up panner, listeners, and resources on unmount", () => {
    const { unmount } = render(
      <VirtualCoworkingCanvas
        roomId="room-1"
        currentUserId="user-me"
        socket={mockSocket as any}
        audioContext={mockAudioContext}
      />
    );

    unmount();

    expect(mockSocket.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    expect(mockPannerInstance.destroy).toHaveBeenCalled();
  });
});
