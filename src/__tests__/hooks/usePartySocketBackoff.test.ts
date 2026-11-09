import {
  calculateJitteredBackoff,
  jitteredReconnectDelay,
  PARTY_SOCKET_RECONNECT_OPTIONS,
} from "../../lib/utils/backoff";

describe("usePartySocket Exponential Backoff & Reconnect Intervals (#4380)", () => {
  describe("calculateJitteredBackoff intervals & randomized +/- 20% jitter", () => {
    test("returns 0 delay for initial connection attempt (attempt <= 0)", () => {
      expect(calculateJitteredBackoff(0)).toBe(0);
      expect(calculateJitteredBackoff(-1)).toBe(0);
    });

    test("calculates attempt 1 backoff (~1s base) with +/- 20% jitter bounds [800ms, 1200ms]", () => {
      const minJitter = calculateJitteredBackoff(1, { random: () => 0 });
      const midJitter = calculateJitteredBackoff(1, { random: () => 0.5 });
      const maxJitter = calculateJitteredBackoff(1, { random: () => 1 });

      expect(minJitter).toBe(800); // 1000 * 0.8
      expect(midJitter).toBe(1000); // 1000 * 1.0
      expect(maxJitter).toBe(1200); // 1000 * 1.2
    });

    test("calculates attempt 2 backoff (~2s base) with +/- 20% jitter bounds [1600ms, 2400ms]", () => {
      const minJitter = calculateJitteredBackoff(2, { random: () => 0 });
      const midJitter = calculateJitteredBackoff(2, { random: () => 0.5 });
      const maxJitter = calculateJitteredBackoff(2, { random: () => 1 });

      expect(minJitter).toBe(1600); // 2000 * 0.8
      expect(midJitter).toBe(2000); // 2000 * 1.0
      expect(maxJitter).toBe(2400); // 2000 * 1.2
    });

    test("calculates attempt 3 backoff (~4s base) with +/- 20% jitter bounds [3200ms, 4800ms]", () => {
      const minJitter = calculateJitteredBackoff(3, { random: () => 0 });
      const midJitter = calculateJitteredBackoff(3, { random: () => 0.5 });
      const maxJitter = calculateJitteredBackoff(3, { random: () => 1 });

      expect(minJitter).toBe(3200); // 4000 * 0.8
      expect(midJitter).toBe(4000); // 4000 * 1.0
      expect(maxJitter).toBe(4800); // 4000 * 1.2
    });

    test("calculates attempt 4 backoff (~8s base) with +/- 20% jitter bounds [6400ms, 9600ms]", () => {
      const minJitter = calculateJitteredBackoff(4, { random: () => 0 });
      const midJitter = calculateJitteredBackoff(4, { random: () => 0.5 });
      const maxJitter = calculateJitteredBackoff(4, { random: () => 1 });

      expect(minJitter).toBe(6400); // 8000 * 0.8
      expect(midJitter).toBe(8000); // 8000 * 1.0
      expect(maxJitter).toBe(9600); // 8000 * 1.2
    });

    test("calculates attempt 5 backoff (~16s base) with +/- 20% jitter bounds [12800ms, 19200ms]", () => {
      const minJitter = calculateJitteredBackoff(5, { random: () => 0 });
      const midJitter = calculateJitteredBackoff(5, { random: () => 0.5 });
      const maxJitter = calculateJitteredBackoff(5, { random: () => 1 });

      expect(minJitter).toBe(12800); // 16000 * 0.8
      expect(midJitter).toBe(16000); // 16000 * 1.0
      expect(maxJitter).toBe(19200); // 16000 * 1.2
    });

    test("caps maximum reconnection delay strictly at 30,000ms (30 seconds)", () => {
      const highAttemptDelay = calculateJitteredBackoff(8, { random: () => 1 });
      expect(highAttemptDelay).toBe(30000);

      const maxDelayAttempt15 = calculateJitteredBackoff(15, { random: () => 0.5 });
      expect(maxDelayAttempt15).toBe(30000);
    });
  });

  describe("jitteredReconnectDelay options overload", () => {
    test("uses default PARTY_SOCKET_RECONNECT_OPTIONS limits", () => {
      expect(PARTY_SOCKET_RECONNECT_OPTIONS.minReconnectionDelay).toBe(1000);
      expect(PARTY_SOCKET_RECONNECT_OPTIONS.maxReconnectionDelay).toBe(30000);
      expect(PARTY_SOCKET_RECONNECT_OPTIONS.maxRetries).toBe(5);
    });

    test("computes backoff with custom base and max delay parameters", () => {
      const delay = jitteredReconnectDelay(1, { baseDelay: 500, maxDelay: 5000 }, () => 0.5);
      expect(delay).toBe(500);
    });
  });
});
