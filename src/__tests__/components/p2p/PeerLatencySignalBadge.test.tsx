import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  PeerLatencySignalBadge,
  calculateRttPing,
  createHeartbeatPing,
  handleHeartbeatPong,
  getLatencyTier,
  formatLatencyLabel,
} from "@/components/p2p/PeerLatencySignalBadge";
import type { MeshPeerNode } from "@/lib/p2p/meshCollabEngine";

describe("PeerLatencySignalBadge utilities", () => {
  it("calculates RTT ping accurately and clamps negative or invalid values", () => {
    expect(calculateRttPing(1000, 1045)).toBe(45);
    expect(calculateRttPing(1050, 1000)).toBe(0); // clock skew
    expect(calculateRttPing(NaN, 1000)).toBe(0);
    expect(calculateRttPing(1000, Infinity)).toBe(0);
  });

  it("creates valid heartbeat ping message", () => {
    const ping = createHeartbeatPing("peer-123", 5000);
    expect(ping).toEqual({
      type: "heartbeat-ping",
      peerId: "peer-123",
      sentAt: 5000,
    });
  });

  it("handles heartbeat pong message and computes latency", () => {
    const latency = handleHeartbeatPong({ sentAt: 1000, receivedAt: 1030 });
    expect(latency).toBe(30);
  });

  it("returns appropriate latency tier and active bars", () => {
    const strong = getLatencyTier(25);
    expect(strong.tier).toBe("strong");
    expect(strong.label).toBe("Strong");
    expect(strong.activeBars).toBe(3);

    const fair = getLatencyTier(80);
    expect(fair.tier).toBe("fair");
    expect(fair.label).toBe("Fair");
    expect(fair.activeBars).toBe(2);

    const high = getLatencyTier(200);
    expect(high.tier).toBe("high_latency");
    expect(high.label).toBe("High Latency");
    expect(high.activeBars).toBe(1);

    const fallback = getLatencyTier(NaN);
    expect(fallback.tier).toBe("strong");
  });

  it("formats latency label with threshold boundary", () => {
    expect(formatLatencyLabel(28)).toBe("28 ms - Strong");
    expect(formatLatencyLabel(120)).toBe("120 ms - Fair");
    expect(formatLatencyLabel(350)).toBe(">300 ms - High Latency");
  });
});

describe("PeerLatencySignalBadge Component", () => {
  const mockPeer: MeshPeerNode = {
    peerId: "peer-abc",
    displayName: "Alice",
    joinedAt: Date.now(),
    role: "collaborator",
    latencyMs: 35,
  } as MeshPeerNode;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders badge with status role and 3 active signal bars for low latency", () => {
    render(<PeerLatencySignalBadge peer={mockPeer} initialLatencyMs={35} />);

    const badge = screen.getByTestId("peer-latency-signal-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("role", "status");
    expect(badge).toHaveAttribute("aria-label", "Ping: 35 ms - Strong");

    expect(screen.getByTestId("signal-bar-1")).toHaveClass("bg-emerald-400");
    expect(screen.getByTestId("signal-bar-2")).toHaveClass("bg-emerald-400");
    expect(screen.getByTestId("signal-bar-3")).toHaveClass("bg-emerald-400");
    expect(screen.getByTestId("latency-text")).toHaveTextContent("35 ms - Strong");
  });

  it("renders 2 active bars for fair latency", () => {
    render(<PeerLatencySignalBadge peer={mockPeer} initialLatencyMs={90} />);

    expect(screen.getByTestId("signal-bar-1")).toHaveClass("bg-amber-400");
    expect(screen.getByTestId("signal-bar-2")).toHaveClass("bg-amber-400");
    expect(screen.getByTestId("signal-bar-3")).toHaveClass("bg-slate-700/60");
  });

  it("hides text label when showTextLabel is false", () => {
    render(
      <PeerLatencySignalBadge
        peer={mockPeer}
        initialLatencyMs={30}
        showTextLabel={false}
      />,
    );

    expect(screen.queryByTestId("latency-text")).not.toBeInTheDocument();
  });

  it("invokes onMeasurePing and onLatencyUpdate on interval tick", () => {
    const onMeasurePing = jest.fn(() => 42);
    const onLatencyUpdate = jest.fn();

    render(
      <PeerLatencySignalBadge
        peer={mockPeer}
        intervalMs={1000}
        onMeasurePing={onMeasurePing}
        onLatencyUpdate={onLatencyUpdate}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(onMeasurePing).toHaveBeenCalled();
    expect(onLatencyUpdate).toHaveBeenCalledWith(42);
  });

  it("handles async onMeasurePing Promise result", async () => {
    const onMeasurePing = jest.fn(() => Promise.resolve(55));
    const onLatencyUpdate = jest.fn();

    render(
      <PeerLatencySignalBadge
        peer={mockPeer}
        intervalMs={1000}
        onMeasurePing={onMeasurePing}
        onLatencyUpdate={onLatencyUpdate}
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(onLatencyUpdate).toHaveBeenCalledWith(55);
  });

  it("applies custom className using cn utility", () => {
    render(
      <PeerLatencySignalBadge
        peer={mockPeer}
        initialLatencyMs={20}
        className="custom-p2p-badge"
      />,
    );

    expect(screen.getByTestId("peer-latency-signal-badge")).toHaveClass(
      "custom-p2p-badge",
    );
  });
});
