import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  RedisLatencyStatusBadge,
  getRedisLatencyStatus,
} from "@/components/admin/RedisLatencyStatusBadge";

describe("getRedisLatencyStatus", () => {
  it("classifies latency < 150ms as healthy", () => {
    expect(getRedisLatencyStatus(0)).toBe("healthy");
    expect(getRedisLatencyStatus(25)).toBe("healthy");
    expect(getRedisLatencyStatus(149)).toBe("healthy");
    expect(getRedisLatencyStatus(149.9)).toBe("healthy");
  });

  it("classifies latency >= 150ms as degraded", () => {
    expect(getRedisLatencyStatus(150)).toBe("degraded");
    expect(getRedisLatencyStatus(200)).toBe("degraded");
    expect(getRedisLatencyStatus(500)).toBe("degraded");
  });

  it("classifies negative latency as offline (e.g. -1 probe error)", () => {
    expect(getRedisLatencyStatus(-1)).toBe("offline");
    expect(getRedisLatencyStatus(-100)).toBe("offline");
  });

  it("classifies null, undefined, NaN, and non-finite as offline", () => {
    expect(getRedisLatencyStatus(null)).toBe("offline");
    expect(getRedisLatencyStatus(undefined)).toBe("offline");
    expect(getRedisLatencyStatus(NaN)).toBe("offline");
    expect(getRedisLatencyStatus(Infinity)).toBe("offline");
    expect(getRedisLatencyStatus(-Infinity)).toBe("offline");
  });
});

describe("RedisLatencyStatusBadge", () => {
  it("renders healthy status badge with correct role and aria-label", () => {
    render(<RedisLatencyStatusBadge latencyMs={28} />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Healthy");
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Redis latency status: Healthy"),
    );
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("28 ms"),
    );
  });

  it("renders degraded status badge for elevated latency", () => {
    render(<RedisLatencyStatusBadge latencyMs={180} />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Degraded");
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Redis latency status: Degraded"),
    );
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("180 ms"),
    );
  });

  it("renders offline status badge when Redis is unavailable (-1 ms)", () => {
    render(<RedisLatencyStatusBadge latencyMs={-1} />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Offline");
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Redis latency status: Offline"),
    );
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Unavailable"),
    );
  });

  it("renders offline status badge safely when latency is null", () => {
    render(<RedisLatencyStatusBadge latencyMs={null} />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Offline");
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Redis latency status: Offline"),
    );
  });

  it("renders healthy at 0ms boundary (mock/local fallback)", () => {
    render(<RedisLatencyStatusBadge latencyMs={0} />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Healthy");
    expect(badge).toHaveAttribute(
      "aria-label",
      expect.stringContaining("0 ms"),
    );
  });

  it("renders degraded at exact 150ms boundary", () => {
    render(<RedisLatencyStatusBadge latencyMs={150} />);

    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Degraded");
  });
});
