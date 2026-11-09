import React from "react";
import { render, screen, act } from "@testing-library/react";
import LocalMeshCollabView from "@/components/p2p/LocalMeshCollabView";
import {
  PeerLatencySignalBadge,
  calculateRttPing,
  createHeartbeatPing,
  handleHeartbeatPong,
  getLatencyTier,
  formatLatencyLabel,
} from "@/components/p2p/PeerLatencySignalBadge";
import { MeshPeerNode, MeshCollabEngine } from "@/lib/p2p/meshCollabEngine";

const mockPeer: MeshPeerNode = {
  peerId: "test-peer-1",
  displayName: "Alice Reed",
  deskLocation: "Desk #01",
  ipSubnet: "192.168.1.50",
  hopCount: 0,
  signalStrengthRssi: -50,
  latencyMs: 28,
  lastSeenTimestamp: 1700000000000,
  status: "connected",
  sharedFilesCount: 3,
};

describe("WebRTC DataChannel RTT Ping Calculation", () => {
  it("calculates RTT accurately from heartbeat send and receive timestamps", () => {
    const sentAt = 1000;
    const receivedAt = 1028;
    expect(calculateRttPing(sentAt, receivedAt)).toBe(28);
  });

  it("clamps negative latency to 0 ms when client clock skew occurs", () => {
    const sentAt = 2000;
    const receivedAt = 1980;
    expect(calculateRttPing(sentAt, receivedAt)).toBe(0);
  });

  it("handles invalid or NaN timestamps safely by returning 0", () => {
    expect(calculateRttPing(NaN, 1000)).toBe(0);
    expect(calculateRttPing(undefined as unknown as number, 1000)).toBe(0);
  });

  it("creates valid heartbeat ping payload and resolves pong RTT", () => {
    const ping = createHeartbeatPing("peer-123", 5000);
    expect(ping).toEqual({
      type: "heartbeat-ping",
      peerId: "peer-123",
      sentAt: 5000,
    });

    const rtt = handleHeartbeatPong({ sentAt: 5000, receivedAt: 5145 });
    expect(rtt).toBe(145);
  });

  it("exposes calculateRttPing on MeshCollabEngine", () => {
    expect(MeshCollabEngine.calculateRttPing(1000, 1042)).toBe(42);
    expect(MeshCollabEngine.calculateRttPing(2000, 1950)).toBe(0);
  });
});

describe("Tiered Signal Bars & Latency Formatting", () => {
  it("categorizes <50ms as strong tier (green, 3 bars)", () => {
    const tier = getLatencyTier(28);
    expect(tier.tier).toBe("strong");
    expect(tier.label).toBe("Strong");
    expect(tier.activeBars).toBe(3);
    expect(tier.barColorClass).toContain("emerald");
    expect(formatLatencyLabel(28)).toBe("28 ms - Strong");
  });

  it("categorizes <150ms (>=50ms) as fair tier (yellow, 2 bars)", () => {
    const tier = getLatencyTier(145);
    expect(tier.tier).toBe("fair");
    expect(tier.label).toBe("Fair");
    expect(tier.activeBars).toBe(2);
    expect(tier.barColorClass).toContain("amber");
    expect(formatLatencyLabel(145)).toBe("145 ms - Fair");
  });

  it("categorizes >=150ms as high latency tier (red, 1 bar)", () => {
    const tier = getLatencyTier(180);
    expect(tier.tier).toBe("high_latency");
    expect(tier.label).toBe("High Latency");
    expect(tier.activeBars).toBe(1);
    expect(tier.barColorClass).toContain("rose");
    expect(formatLatencyLabel(180)).toBe("180 ms - High Latency");
  });

  it("formats latency greater than 300ms as '>300 ms - High Latency'", () => {
    expect(formatLatencyLabel(325)).toBe(">300 ms - High Latency");
    expect(formatLatencyLabel(450)).toBe(">300 ms - High Latency");
  });
});

describe("PeerLatencySignalBadge Component", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("renders 3 green bars for <50ms latency (e.g. 28 ms - Strong)", () => {
    render(<PeerLatencySignalBadge peer={mockPeer} initialLatencyMs={28} />);

    expect(screen.getByText("28 ms - Strong")).toBeInTheDocument();
    const bar1 = screen.getByTestId("signal-bar-1");
    const bar2 = screen.getByTestId("signal-bar-2");
    const bar3 = screen.getByTestId("signal-bar-3");

    expect(bar1.className).toContain("bg-emerald-400");
    expect(bar2.className).toContain("bg-emerald-400");
    expect(bar3.className).toContain("bg-emerald-400");
  });

  it("renders 2 yellow bars and 1 muted bar for <150ms latency (e.g. 145 ms - Fair)", () => {
    render(<PeerLatencySignalBadge peer={mockPeer} initialLatencyMs={145} />);

    expect(screen.getByText("145 ms - Fair")).toBeInTheDocument();
    const bar1 = screen.getByTestId("signal-bar-1");
    const bar2 = screen.getByTestId("signal-bar-2");
    const bar3 = screen.getByTestId("signal-bar-3");

    expect(bar1.className).toContain("bg-amber-400");
    expect(bar2.className).toContain("bg-amber-400");
    expect(bar3.className).toContain("bg-slate-700/60");
  });

  it("renders 1 red bar and 2 muted bars for >=150ms latency", () => {
    render(<PeerLatencySignalBadge peer={mockPeer} initialLatencyMs={200} />);

    expect(screen.getByText("200 ms - High Latency")).toBeInTheDocument();
    const bar1 = screen.getByTestId("signal-bar-1");
    const bar2 = screen.getByTestId("signal-bar-2");
    const bar3 = screen.getByTestId("signal-bar-3");

    expect(bar1.className).toContain("bg-rose-500");
    expect(bar2.className).toContain("bg-slate-700/60");
    expect(bar3.className).toContain("bg-slate-700/60");
  });

  it("renders accessible role='status' with aria-label", () => {
    const { container } = render(
      <PeerLatencySignalBadge peer={mockPeer} initialLatencyMs={28} />,
    );
    const badge = container.querySelector('[role="status"]');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("aria-label", "Ping: 28 ms - Strong");
  });

  it("updates latency metrics every 5 seconds via interval timer", () => {
    let measuredPing = 35;
    const onMeasurePing = jest.fn(() => measuredPing);

    render(
      <PeerLatencySignalBadge
        peer={mockPeer}
        initialLatencyMs={28}
        onMeasurePing={onMeasurePing}
      />,
    );

    expect(screen.getByText("28 ms - Strong")).toBeInTheDocument();

    // Advance 5 seconds
    measuredPing = 145;
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(onMeasurePing).toHaveBeenCalledTimes(1);
    expect(screen.getByText("145 ms - Fair")).toBeInTheDocument();

    // Advance another 5 seconds to high latency
    measuredPing = 320;
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(onMeasurePing).toHaveBeenCalledTimes(2);
    expect(screen.getByText(">300 ms - High Latency")).toBeInTheDocument();
  });

  it("cleans up 5-second interval on unmount", () => {
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const { unmount } = render(
      <PeerLatencySignalBadge peer={mockPeer} initialLatencyMs={28} />,
    );

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("does not trigger parent re-renders when latency updates every 5 seconds", () => {
    let parentRenderCount = 0;

    function ParentWrapper() {
      parentRenderCount++;
      return (
        <div data-testid="parent-container">
          <PeerLatencySignalBadge
            peer={mockPeer}
            initialLatencyMs={28}
            onMeasurePing={() => 42}
          />
        </div>
      );
    }

    render(<ParentWrapper />);
    expect(parentRenderCount).toBe(1);

    // Advance timer by 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Child updated its internal latency state, parent did NOT re-render
    expect(parentRenderCount).toBe(1);

    // Advance another 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(parentRenderCount).toBe(1);
  });
});

describe("LocalMeshCollabView Integration", () => {
  it("renders peer signal badges with round-trip ping for all peers", () => {
    const customPeers: MeshPeerNode[] = [
      {
        ...mockPeer,
        peerId: "peer-fast",
        displayName: "Fast Peer",
        latencyMs: 22,
      },
      {
        ...mockPeer,
        peerId: "peer-med",
        displayName: "Medium Peer",
        latencyMs: 85,
      },
      {
        ...mockPeer,
        peerId: "peer-slow",
        displayName: "Slow Peer",
        latencyMs: 320,
      },
    ];

    const { unmount } = render(
      <LocalMeshCollabView initialPeers={customPeers} />,
    );

    expect(screen.getByText("Fast Peer")).toBeInTheDocument();
    expect(screen.getByText("Medium Peer")).toBeInTheDocument();
    expect(screen.getByText("Slow Peer")).toBeInTheDocument();

    expect(screen.getByText("22 ms - Strong")).toBeInTheDocument();
    expect(screen.getByText("85 ms - Fair")).toBeInTheDocument();
    expect(screen.getByText(">300 ms - High Latency")).toBeInTheDocument();

    unmount();
  });
});
