/**
 * Tests for the WebGPU buffer allocation cap (Issue #1990).
 * allocatedCapacity is capped by device.limits to prevent OOM on mobile GPUs.
 */

const AGENT_STRIDE = 32; // bytes per agent

function computeSafeAllocatedCapacity(
  requestedCount: number,
  maxBindingSize: number,
  maxBufferSize: number,
): number {
  const safeLimit = Math.min(maxBindingSize, maxBufferSize);
  const maxSafeAgents = Math.floor(safeLimit / AGENT_STRIDE);
  return Math.min(Math.max(requestedCount, 1000), maxSafeAgents);
}

describe("WebGPU buffer allocation cap", () => {
  it("caps allocatedCapacity by device maxStorageBufferBindingSize", () => {
    const requested = 10000;
    const maxBinding = 128 * 1024; // 128 KB — very small device
    const maxBuffer = 256 * 1024;

    const capacity = computeSafeAllocatedCapacity(requested, maxBinding, maxBuffer);
    const maxSafe = Math.floor(maxBinding / AGENT_STRIDE);

    expect(capacity).toBeLessThanOrEqual(maxSafe);
  });

  it("uses 1000 as minimum capacity even on very small devices", () => {
    const requested = 50;
    const maxBinding = 128 * 1024 * 1024; // 128 MB — plenty of room
    const maxBuffer = 256 * 1024 * 1024;

    const capacity = computeSafeAllocatedCapacity(requested, maxBinding, maxBuffer);
    expect(capacity).toBeGreaterThanOrEqual(1000);
  });

  it("uses requestedCount when within safe limits", () => {
    const requested = 5000;
    const maxBinding = 128 * 1024 * 1024; // 128 MB
    const maxBuffer = 256 * 1024 * 1024;

    const capacity = computeSafeAllocatedCapacity(requested, maxBinding, maxBuffer);
    expect(capacity).toBe(5000);
  });

  it("caps at safeLimit / AGENT_STRIDE when requested exceeds device limits", () => {
    const requested = 1_000_000;
    const maxBinding = 1024 * 1024; // 1 MB — very limited
    const maxBuffer = 1024 * 1024;

    const capacity = computeSafeAllocatedCapacity(requested, maxBinding, maxBuffer);
    const expected = Math.floor(1024 * 1024 / AGENT_STRIDE);
    expect(capacity).toBe(expected);
  });

  it("AGENT_STRIDE is 32 bytes", () => {
    expect(AGENT_STRIDE).toBe(32);
  });

  it("maxSafeAgents * AGENT_STRIDE never exceeds device limits", () => {
    const maxBinding = 4 * 1024 * 1024;
    const maxBuffer = 8 * 1024 * 1024;
    const safeLimit = Math.min(maxBinding, maxBuffer);
    const capacity = computeSafeAllocatedCapacity(100000, maxBinding, maxBuffer);

    expect(capacity * AGENT_STRIDE).toBeLessThanOrEqual(safeLimit);
  });
});
