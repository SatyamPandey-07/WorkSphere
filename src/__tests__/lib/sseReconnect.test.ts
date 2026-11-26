import {
  getSseReconnectDelay,
  SSE_RECONNECT_INITIAL_DELAY,
  SSE_RECONNECT_MAX_DELAY,
} from "@/lib/sseReconnect";

describe("getSseReconnectDelay", () => {
  it("starts with approximately one second", () => {
    expect(getSseReconnectDelay(0, () => 0.5)).toBe(1_000);
  });

  it("increases exponentially", () => {
    expect(getSseReconnectDelay(0, () => 0.5)).toBe(1_000);
    expect(getSseReconnectDelay(1, () => 0.5)).toBe(2_000);
    expect(getSseReconnectDelay(2, () => 0.5)).toBe(4_000);
    expect(getSseReconnectDelay(3, () => 0.5)).toBe(8_000);
    expect(getSseReconnectDelay(4, () => 0.5)).toBe(16_000);
  });

  it("applies negative and positive 20 percent jitter", () => {
    expect(getSseReconnectDelay(0, () => 0)).toBe(800);
    expect(getSseReconnectDelay(0, () => 1)).toBe(1_200);
  });

  it("never exceeds the maximum delay", () => {
    expect(getSseReconnectDelay(10, () => 1)).toBe(SSE_RECONNECT_MAX_DELAY);
    expect(getSseReconnectDelay(100, () => 1)).toBe(SSE_RECONNECT_MAX_DELAY);
  });

  it("keeps the capped delay within the jitter bounds", () => {
    expect(getSseReconnectDelay(10, () => 0)).toBe(24_000);
    expect(getSseReconnectDelay(10, () => 1)).toBe(30_000);
  });

  it("handles negative attempts safely", () => {
    expect(getSseReconnectDelay(-1, () => 0.5)).toBe(
      SSE_RECONNECT_INITIAL_DELAY,
    );
  });
});
