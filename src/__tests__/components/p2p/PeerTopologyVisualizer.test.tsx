import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  PeerTopologyVisualizer,
  getLatencyBadgeTier,
} from "@/components/p2p/PeerTopologyVisualizer";
import {
  MESH_HEARTBEAT_INTERVAL_MS,
  MESH_HEARTBEAT_MAGIC,
  MeshHeartbeatType,
  decodeHeartbeatFrame,
  encodeHeartbeatFrame,
  useMeshDataChannels,
} from "@/hooks/useMeshDataChannels";

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

let mockSocketOptions: { onMessage?: (ev: { data: string }) => void } | null = null;
jest.mock("partysocket/react", () => {
  return jest.fn((options: { onMessage?: (ev: { data: string }) => void }) => {
    mockSocketOptions = options;
    return {
      send: jest.fn(),
      close: jest.fn(),
    };
  });
});

jest.mock("@/lib/crdt/stateVectorChecksum", () => ({
  resetStateVectorChecksumCache: jest.fn(),
}));

class MockRtcDataChannel {
  public readyState: RTCDataChannelState = "open";
  public bufferedAmount = 0;
  public bufferedAmountLowThreshold = 0;
  public binaryType = "arraybuffer";
  public sentBuffers: ArrayBuffer[] = [];
  public onopen: ((ev: unknown) => void) | null = null;
  public onclose: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;

  public send(data: ArrayBuffer | ArrayBufferView | string): void {
    if (data instanceof ArrayBuffer) {
      this.sentBuffers.push(data);
    } else if (ArrayBuffer.isView(data)) {
      const copy = new Uint8Array(data.byteLength);
      copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      this.sentBuffers.push(copy.buffer);
    }
  }

  public addEventListener(): void {}
  public removeEventListener(): void {}
  public close(): void {
    this.readyState = "closed";
  }
}

describe("PeerTopologyVisualizer & WebRTC Ping/Pong Heartbeats (#9758, #10536)", () => {
  describe("Binary 0x5049 ('PI') heartbeat framing", () => {
    it("encodes and decodes PING and PONG frames with 0x5049 magic", () => {
      const ping = encodeHeartbeatFrame(MeshHeartbeatType.PING, 123456);
      const view = new DataView(ping);
      expect(view.getUint16(0, false)).toBe(MESH_HEARTBEAT_MAGIC);
      expect(decodeHeartbeatFrame(ping)).toEqual({
        type: MeshHeartbeatType.PING,
        sentAt: 123456,
      });

      const pong = encodeHeartbeatFrame(MeshHeartbeatType.PONG, 987654);
      expect(decodeHeartbeatFrame(pong)).toEqual({
        type: MeshHeartbeatType.PONG,
        sentAt: 987654,
      });

      // Non-heartbeat payload returns null
      const crdtBytes = new Uint8Array([0x57, 0x53, 1, 2, 3, 4]).buffer;
      expect(decodeHeartbeatFrame(crdtBytes)).toBeNull();
    });
  });

  describe("getLatencyBadgeTier thresholds", () => {
    it("maps <50ms to green, 50-150ms to yellow, >150ms to red, and null to unknown", () => {
      expect(getLatencyBadgeTier(24).tone).toBe("green");
      expect(getLatencyBadgeTier(49).tone).toBe("green");
      expect(getLatencyBadgeTier(50).tone).toBe("yellow");
      expect(getLatencyBadgeTier(150).tone).toBe("yellow");
      expect(getLatencyBadgeTier(151).tone).toBe("red");
      expect(getLatencyBadgeTier(null).tone).toBe("unknown");
    });
  });

  describe("PeerTopologyVisualizer UI", () => {
    it("displays green, yellow, red, and pending latency badges next to peer avatars", () => {
      render(
        <PeerTopologyVisualizer
          localPeerId="local-user"
          localDisplayName="Asha"
          peers={[
            { peerId: "peer-fast", displayName: "Dev One", role: "Editor" },
            { peerId: "peer-mid", displayName: "Sam Two" },
            { peerId: "peer-slow", displayName: "Lee Three" },
            { peerId: "peer-pending", displayName: "New Peer" },
          ]}
          peerLatencies={{
            "peer-fast": 32,
            "peer-mid": 110,
            "peer-slow": 220,
          }}
        />,
      );

      const fastBadge = screen.getByTestId("peer-latency-badge-peer-fast");
      expect(fastBadge).toHaveAttribute("data-latency-tier", "green");
      expect(fastBadge).toHaveTextContent("32 ms");

      const midBadge = screen.getByTestId("peer-latency-badge-peer-mid");
      expect(midBadge).toHaveAttribute("data-latency-tier", "yellow");
      expect(midBadge).toHaveTextContent("110 ms");

      const slowBadge = screen.getByTestId("peer-latency-badge-peer-slow");
      expect(slowBadge).toHaveAttribute("data-latency-tier", "red");
      expect(slowBadge).toHaveTextContent("220 ms");

      const pendingBadge = screen.getByTestId("peer-latency-badge-peer-pending");
      expect(pendingBadge).toHaveAttribute("data-latency-tier", "unknown");
      expect(pendingBadge).toHaveTextContent("-- ms");
    });

    describe("Copy Diagnostics Button (#10536)", () => {
      const originalClipboard = navigator.clipboard;

      afterEach(() => {
        Object.defineProperty(navigator, "clipboard", {
          value: originalClipboard,
          configurable: true,
          writable: true,
        });
        jest.useRealTimers();
      });

      it("renders the Copy Diagnostics button with accessible name", () => {
        render(
          <PeerTopologyVisualizer
            localPeerId="user-loc-1"
            peers={[{ peerId: "p1", displayName: "Peer 1" }]}
          />,
        );

        const btn = screen.getByTestId("copy-diagnostics-btn");
        expect(btn).toBeInTheDocument();
        expect(btn).toHaveAttribute("aria-label", "Copy Diagnostics");
        expect(btn).toHaveTextContent("Copy Diagnostics");
      });

      it("copies readable, valid JSON summary to clipboard and displays confirmation state", async () => {
        const writeTextMock = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: writeTextMock },
          configurable: true,
          writable: true,
        });

        render(
          <PeerTopologyVisualizer
            localPeerId="local-client-123"
            localDisplayName="Local User"
            peers={[
              { peerId: "peer-1", displayName: "Alice", rttMs: 28 },
              { peerId: "peer-2", displayName: "Bob" },
            ]}
            peerLatencies={{
              "peer-2": 85,
            }}
          />,
        );

        const btn = screen.getByTestId("copy-diagnostics-btn");
        fireEvent.click(btn);

        await waitFor(() => {
          expect(writeTextMock).toHaveBeenCalledTimes(1);
        });

        const copiedPayload = JSON.parse(writeTextMock.mock.calls[0][0]);
        expect(copiedPayload.localPeerId).toBe("local-client-123");
        expect(copiedPayload.timestamp).toBeDefined();
        expect(copiedPayload.peers).toEqual([
          { peerId: "peer-1", displayName: "Alice", rttMs: 28 },
          { peerId: "peer-2", displayName: "Bob", rttMs: 85 },
        ]);

        expect(btn).toHaveTextContent("Diagnostics copied");
        const status = screen.getByTestId("copy-diagnostics-status");
        expect(status).toHaveTextContent("Diagnostics copied to clipboard");
      });

      it("handles clipboard failure gracefully and displays accessible error state", async () => {
        const writeTextMock = jest
          .fn()
          .mockRejectedValue(new Error("Permission denied"));
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: writeTextMock },
          configurable: true,
          writable: true,
        });

        render(
          <PeerTopologyVisualizer
            localPeerId="local-client-123"
            peers={[{ peerId: "peer-1", displayName: "Alice" }]}
          />,
        );

        const btn = screen.getByTestId("copy-diagnostics-btn");
        fireEvent.click(btn);

        await waitFor(() => {
          expect(btn).toHaveTextContent("Failed to copy");
        });

        const status = screen.getByTestId("copy-diagnostics-status");
        expect(status).toHaveTextContent("Failed to copy diagnostics to clipboard");
      });

      it("resets confirmation state back to idle after timeout", async () => {
        jest.useFakeTimers();
        const writeTextMock = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: writeTextMock },
          configurable: true,
          writable: true,
        });

        render(
          <PeerTopologyVisualizer
            localPeerId="local-client-123"
            peers={[{ peerId: "peer-1", displayName: "Alice", rttMs: 40 }]}
          />,
        );

        const btn = screen.getByTestId("copy-diagnostics-btn");
        await act(async () => {
          fireEvent.click(btn);
        });

        expect(btn).toHaveTextContent("Diagnostics copied");

        act(() => {
          jest.advanceTimersByTime(2100);
        });

        expect(btn).toHaveTextContent("Copy Diagnostics");
      });
    });
  });

  describe("useMeshDataChannels heartbeat lifecycle", () => {
    let originalRTCPeerConnection: unknown;

    beforeEach(() => {
      jest.useFakeTimers();
      originalRTCPeerConnection = global.RTCPeerConnection;
      mockSocketOptions = null;
    });

    afterEach(() => {
      jest.useRealTimers();
      global.RTCPeerConnection = originalRTCPeerConnection as typeof RTCPeerConnection;
    });

    it("sends 0x5049 ping every 10s, echoes pong without hitting CRDT onData, measures RTT, and cleans up on unmount", async () => {
      const mockDc = new MockRtcDataChannel();
      const closePeerSpy = jest.fn();

      (global as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = jest
        .fn()
        .mockImplementation(() => ({
          signalingState: "stable",
          connectionState: "connected",
          iceConnectionState: "connected",
          close: closePeerSpy,
          createOffer: jest.fn().mockResolvedValue({ sdp: "offer" }),
          createAnswer: jest.fn().mockResolvedValue({ sdp: "answer" }),
          setLocalDescription: jest.fn().mockResolvedValue(undefined),
          setRemoteDescription: jest.fn().mockResolvedValue(undefined),
          addIceCandidate: jest.fn().mockResolvedValue(undefined),
          createDataChannel: jest.fn().mockReturnValue(mockDc),
          getStats: jest.fn().mockResolvedValue(new Map()),
          onicecandidate: null,
          ondatachannel: null,
          oniceconnectionstatechange: null,
        }));

      let currentNow = 10_000;
      const onData = jest.fn();

      const { result, unmount } = renderHook(() =>
        useMeshDataChannels({
          roomId: "mesh-room-1",
          userId: "local-user",
          onData,
          nowFn: () => currentNow,
          sampleIntervalMs: 60_000,
        }),
      );

      await act(async () => {
        mockSocketOptions?.onMessage?.({
          data: JSON.stringify({
            type: "webrtc-signal",
            kind: "peer-join",
            from: "peer-alpha",
          }),
        });
      });

      await act(async () => {
        mockDc.onopen?.({});
      });

      // Advance by 10 seconds to trigger periodic 0x5049 PING
      currentNow = 20_000;
      await act(async () => {
        jest.advanceTimersByTime(MESH_HEARTBEAT_INTERVAL_MS);
      });

      expect(mockDc.sentBuffers).toHaveLength(1);
      expect(decodeHeartbeatFrame(mockDc.sentBuffers[0])).toEqual({
        type: MeshHeartbeatType.PING,
        sentAt: 20_000,
      });

      // Simulate PONG returning 42ms later
      currentNow = 20_042;
      await act(async () => {
        mockDc.onmessage?.({
          data: encodeHeartbeatFrame(MeshHeartbeatType.PONG, 20_000),
        });
      });

      expect(result.current.peerLatencies["peer-alpha"]).toBe(42);
      expect(result.current.peerTelemetry["peer-alpha"]?.rttMs).toBe(42);
      expect(onData).not.toHaveBeenCalled();

      // Simulate incoming PING from remote peer -> should echo PONG without calling onData
      await act(async () => {
        mockDc.onmessage?.({
          data: encodeHeartbeatFrame(MeshHeartbeatType.PING, 19_500),
        });
      });
      expect(mockDc.sentBuffers).toHaveLength(2);
      expect(decodeHeartbeatFrame(mockDc.sentBuffers[1])).toEqual({
        type: MeshHeartbeatType.PONG,
        sentAt: 19_500,
      });
      expect(onData).not.toHaveBeenCalled();

      // Unmount should clear heartbeat timer so no further pings are sent
      unmount();
      const countAfterUnmount = mockDc.sentBuffers.length;
      await act(async () => {
        jest.advanceTimersByTime(MESH_HEARTBEAT_INTERVAL_MS * 2);
      });
      expect(mockDc.sentBuffers).toHaveLength(countAfterUnmount);
    });
  });
});
