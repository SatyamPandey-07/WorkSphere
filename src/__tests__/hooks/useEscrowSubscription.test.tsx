/**
 * Comprehensive test suite for useEscrowSubscription and resilient Solana
 * WebSocket disconnect recovery with HTTP confirmation fallback (#7855).
 *
 * All timers and Solana SDK calls are mocked — no live network interactions.
 */

// Fix jsdom Buffer vs Uint8Array realm mismatch for @noble/hashes
Object.defineProperty(Uint8Array, Symbol.hasInstance, {
  value: (inst: unknown) =>
    (inst != null &&
      typeof inst === "object" &&
      (inst.constructor?.name === "Buffer" ||
        inst.constructor?.name === "Uint8Array" ||
        Buffer.isBuffer(inst))) ||
    false,
  configurable: true,
});

import { renderHook, act } from "@testing-library/react";
import type { Connection, SignatureStatus } from "@solana/web3.js";
import { useEscrowSubscription } from "@/hooks/useEscrowSubscription";
import { subscribeToEscrowConfirmation } from "@/lib/solana/escrowClient";

const MOCK_SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJklSzLj699";
const MOCK_SIGNATURE_2 =
  "3ABCv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJklSzLj222";

interface MockConnectionFixture {
  connection: Connection;
  callbacks: Record<string, (notification: any, context: any) => void>;
  stateChangeCallbacks: Record<number, (state: string) => void>;
  eventHandlers: Record<string, Array<(...args: any[]) => void>>;
  getSignatureStatuses: jest.Mock;
  getBlockHeight: jest.Mock;
  emitWsStatus: (
    commitment: "processed" | "confirmed" | "finalized",
    notification: any,
    context?: any,
  ) => void;
  emitSubStateChange: (subId: number, state: string) => void;
  emitSocketEvent: (event: string, ...args: any[]) => void;
}

function createMockStreamingConnection(): MockConnectionFixture {
  let subCounter = 1;
  const callbacks: Record<string, (notification: any, context: any) => void> = {};
  const stateChangeCallbacks: Record<number, (state: string) => void> = {};
  const eventHandlers: Record<string, Array<(...args: any[]) => void>> = {};

  const onSignatureWithOptions = jest.fn(
    (sig: string, callback: any, options: { commitment: string }) => {
      const id = subCounter++;
      callbacks[options.commitment] = callback;
      return id;
    },
  );

  const removeSignatureListener = jest.fn((id: number) => {
    return Promise.resolve();
  });

  const _onSubscriptionStateChange = jest.fn((subId: number, cb: (state: string) => void) => {
    stateChangeCallbacks[subId] = cb;
    return () => {
      delete stateChangeCallbacks[subId];
    };
  });

  const getSignatureStatuses = jest.fn().mockResolvedValue({
    value: [null],
  });

  const getBlockHeight = jest.fn().mockResolvedValue(100);

  const on = jest.fn((event: string, cb: (...args: any[]) => void) => {
    if (!eventHandlers[event]) eventHandlers[event] = [];
    eventHandlers[event].push(cb);
  });

  const off = jest.fn((event: string, cb: (...args: any[]) => void) => {
    if (eventHandlers[event]) {
      eventHandlers[event] = eventHandlers[event].filter((handler) => handler !== cb);
    }
  });

  const connection = {
    onSignatureWithOptions,
    removeSignatureListener,
    _onSubscriptionStateChange,
    getSignatureStatuses,
    getBlockHeight,
    on,
    off,
  } as unknown as Connection;

  return {
    connection,
    callbacks,
    stateChangeCallbacks,
    eventHandlers,
    getSignatureStatuses,
    getBlockHeight,
    emitWsStatus: (commitment, notification, context = { slot: 1234 }) => {
      callbacks[commitment]?.(notification, context);
    },
    emitSubStateChange: (subId, state) => {
      stateChangeCallbacks[subId]?.(state);
    },
    emitSocketEvent: (event, ...args) => {
      eventHandlers[event]?.forEach((h) => h(...args));
    },
  };
}

describe("useEscrowSubscription Hook & Resilient Fallback (#7855)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Scenario 1: WebSocket happy path: processed -> confirmed -> finalized transitions monotonically
  it("Scenario 1: Happy path WebSocket streaming: processed -> confirmed -> finalized", () => {
    const fixture = createMockStreamingConnection();
    const onConfirmed = jest.fn();
    const onFinalized = jest.fn();

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        onConfirmed,
        onFinalized,
      }),
    );

    expect(result.current.status).toBe("pending");
    expect(result.current.isConfirming).toBe(true);

    act(() => {
      fixture.emitWsStatus("processed", { err: null }, { slot: 100 });
    });
    expect(result.current.status).toBe("processed");
    expect(result.current.source).toBe("websocket");
    expect(result.current.slot).toBe(100);

    act(() => {
      fixture.emitWsStatus("confirmed", { err: null }, { slot: 105 });
    });
    expect(result.current.status).toBe("confirmed");
    expect(result.current.isConfirmed).toBe(true);
    expect(onConfirmed).toHaveBeenCalledTimes(1);

    act(() => {
      fixture.emitWsStatus("finalized", { err: null }, { slot: 137 });
    });
    expect(result.current.status).toBe("finalized");
    expect(result.current.isFinalized).toBe(true);
    expect(result.current.isTerminal).toBe(true);
    expect(onFinalized).toHaveBeenCalledTimes(1);
  });

  // Scenario 2: WebSocket disconnect during active confirmation activates HTTP fallback immediately
  it("Scenario 2: WebSocket disconnect event activates HTTP fallback immediately", async () => {
    const fixture = createMockStreamingConnection();
    const onFallbackPolling = jest.fn();
    const onWebSocketDisconnect = jest.fn();

    fixture.getSignatureStatuses.mockResolvedValue({
      value: [
        {
          slot: 110,
          confirmations: 30,
          err: null,
          confirmationStatus: "confirmed",
        },
      ],
    });

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        onFallbackPolling,
        onWebSocketDisconnect,
        minPollIntervalMs: 200,
      }),
    );

    expect(result.current.status).toBe("pending");

    // Trigger disconnect via socket event
    await act(async () => {
      fixture.emitSocketEvent("close");
    });

    expect(onWebSocketDisconnect).toHaveBeenCalledTimes(1);
    expect(onFallbackPolling).toHaveBeenCalledTimes(1);
    expect(result.current.isFallbackPolling).toBe(true);

    // Let the immediate poll resolve
    await act(async () => {
      jest.advanceTimersByTime(10);
    });

    expect(fixture.getSignatureStatuses).toHaveBeenCalledWith([MOCK_SIGNATURE], {
      searchTransactionHistory: true,
    });
    expect(result.current.status).toBe("confirmed");
    expect(result.current.source).toBe("http_polling");
  });

  // Scenario 3: WebSocket subscription error triggers fallback
  it("Scenario 3: Subscription state change to error triggers HTTP fallback", async () => {
    const fixture = createMockStreamingConnection();
    const onFallbackPolling = jest.fn();

    fixture.getSignatureStatuses.mockResolvedValue({
      value: [
        {
          slot: 112,
          confirmations: null,
          err: null,
          confirmationStatus: "finalized",
        },
      ],
    });

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        onFallbackPolling,
        minPollIntervalMs: 200,
      }),
    );

    await act(async () => {
      fixture.emitSubStateChange(1, "error");
    });

    expect(onFallbackPolling).toHaveBeenCalledTimes(1);
    expect(result.current.isFallbackPolling).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(10);
    });

    expect(result.current.status).toBe("finalized");
  });

  // Scenario 4: Connection error event activates HTTP fallback
  it("Scenario 4: Connection error event activates fallback immediately", async () => {
    const fixture = createMockStreamingConnection();
    const onFallbackPolling = jest.fn();

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        onFallbackPolling,
      }),
    );

    await act(async () => {
      fixture.emitSocketEvent("error", new Error("Socket disconnected unexpectedly"));
    });

    expect(onFallbackPolling).toHaveBeenCalledTimes(1);
    expect(result.current.isFallbackPolling).toBe(true);
  });

  // Scenario 5: Repeated disconnect notifications do NOT spawn duplicate polling loops
  it("Scenario 5: Repeated disconnect notifications do not spawn duplicate polling loops", async () => {
    const fixture = createMockStreamingConnection();
    const onFallbackPolling = jest.fn();

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        onFallbackPolling,
      }),
    );

    await act(async () => {
      fixture.emitSocketEvent("close");
      fixture.emitSocketEvent("close");
      fixture.emitSubStateChange(1, "pending");
      fixture.emitSubStateChange(2, "pending");
    });

    expect(onFallbackPolling).toHaveBeenCalledTimes(1);
  });

  // Scenario 6 & 7: HTTP polling confirms & finalizes transaction
  it("Scenario 6 & 7: HTTP polling transitions to confirmed, then finalized", async () => {
    const fixture = createMockStreamingConnection();

    fixture.getSignatureStatuses
      .mockResolvedValueOnce({
        value: [
          {
            slot: 201,
            confirmations: 25,
            err: null,
            confirmationStatus: "confirmed",
          },
        ],
      })
      .mockResolvedValueOnce({
        value: [
          {
            slot: 233,
            confirmations: null,
            err: null,
            confirmationStatus: "finalized",
          },
        ],
      });

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        minPollIntervalMs: 500,
        maxPollIntervalMs: 2000,
      }),
    );

    // Trigger fallback
    await act(async () => {
      fixture.emitSocketEvent("close");
    });

    // 1st poll
    await act(async () => {
      jest.advanceTimersByTime(10);
    });

    expect(result.current.status).toBe("confirmed");
    expect(result.current.slot).toBe(201);
    expect(result.current.isConfirmed).toBe(true);
    expect(result.current.isFinalized).toBe(false);

    // 2nd poll after backoff
    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.status).toBe("finalized");
    expect(result.current.slot).toBe(233);
    expect(result.current.isFinalized).toBe(true);
    expect(result.current.isTerminal).toBe(true);
  });

  // Scenario 8: On-chain transaction failure reported via HTTP polling
  it("Scenario 8: On-chain execution failure is reported in failed state", async () => {
    const fixture = createMockStreamingConnection();
    const onError = jest.fn();

    fixture.getSignatureStatuses.mockResolvedValue({
      value: [
        {
          slot: 205,
          confirmations: 20,
          err: { InstructionError: [1, "CustomError"] },
          confirmationStatus: "confirmed",
        },
      ],
    });

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        onError,
      }),
    );

    await act(async () => {
      fixture.emitSocketEvent("close");
    });

    await act(async () => {
      jest.advanceTimersByTime(10);
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.isTerminal).toBe(true);
    expect(result.current.error).toContain("InstructionError");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("InstructionError"),
      }),
      expect.anything(),
    );
  });

  // Scenario 9: Temporary HTTP network errors do not crash loop and back off
  it("Scenario 9: Temporary HTTP network errors retry with exponential backoff", async () => {
    const fixture = createMockStreamingConnection();

    fixture.getSignatureStatuses
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValueOnce({
        value: [
          {
            slot: 250,
            confirmations: null,
            err: null,
            confirmationStatus: "finalized",
          },
        ],
      });

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        minPollIntervalMs: 500,
        maxPollIntervalMs: 4000,
        pollBackoffMultiplier: 2.0,
      }),
    );

    await act(async () => {
      fixture.emitSocketEvent("close");
    });

    // 1st poll rejected
    await act(async () => {
      jest.advanceTimersByTime(10);
    });

    expect(result.current.status).toBe("fallback_polling");

    // Advance by backoff delay (500ms)
    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.status).toBe("finalized");
  });

  // Scenario 10 & 11: Polling stops cleanly after finality or terminal failure
  it("Scenario 10 & 11: Polling stops after terminal finality and makes no further calls", async () => {
    const fixture = createMockStreamingConnection();

    fixture.getSignatureStatuses.mockResolvedValue({
      value: [
        {
          slot: 300,
          confirmations: null,
          err: null,
          confirmationStatus: "finalized",
        },
      ],
    });

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        minPollIntervalMs: 500,
      }),
    );

    await act(async () => {
      fixture.emitSocketEvent("close");
    });

    await act(async () => {
      jest.advanceTimersByTime(10);
    });

    expect(result.current.status).toBe("finalized");
    const callCount = fixture.getSignatureStatuses.mock.calls.length;

    // Advance long into the future
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    expect(fixture.getSignatureStatuses.mock.calls.length).toBe(callCount);
  });

  // Scenario 12: Target commitment levels respected
  it("Scenario 12: Stops polling when target commitment is confirmed", async () => {
    const fixture = createMockStreamingConnection();

    fixture.getSignatureStatuses.mockResolvedValue({
      value: [
        {
          slot: 305,
          confirmations: 20,
          err: null,
          confirmationStatus: "confirmed",
        },
      ],
    });

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        commitment: "confirmed",
        minPollIntervalMs: 500,
      }),
    );

    await act(async () => {
      fixture.emitSocketEvent("close");
    });

    await act(async () => {
      jest.advanceTimersByTime(10);
    });

    expect(result.current.status).toBe("confirmed");
    const calls = fixture.getSignatureStatuses.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(fixture.getSignatureStatuses.mock.calls.length).toBe(calls);
  });

  // Scenario 13 & 14 & 15: Blockhash expiry handling & final historical check
  it("Scenario 13 & 14 & 15: Blockhash expiration triggers final historical status check before timing out", async () => {
    const fixture = createMockStreamingConnection();
    const onTimeout = jest.fn();

    // Block height starts below valid height, then exceeds it
    fixture.getBlockHeight.mockResolvedValueOnce(50).mockResolvedValue(120);

    // Initial polls return null
    fixture.getSignatureStatuses.mockResolvedValue({
      value: [null],
    });

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
        lastValidBlockHeight: 100,
        minPollIntervalMs: 500,
        onTimeout,
      }),
    );

    await act(async () => {
      fixture.emitSocketEvent("close");
    });

    // 1st poll at block height 50
    await act(async () => {
      jest.advanceTimersByTime(10);
    });

    expect(result.current.status).toBe("fallback_polling");

    // 2nd poll at block height 120 (> 100). Triggers final check and timeout
    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(result.current.status).toBe("timeout");
    expect(result.current.error).toContain("blockhash expired");
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  // Scenario 16: Late WebSocket notification arriving after HTTP confirmation is handled monotonically
  it("Scenario 16: Late arriving WS event does not regress HTTP confirmed status", async () => {
    const fixture = createMockStreamingConnection();

    fixture.getSignatureStatuses.mockResolvedValue({
      value: [
        {
          slot: 400,
          confirmations: 20,
          err: null,
          confirmationStatus: "confirmed",
        },
      ],
    });

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
      }),
    );

    // Fall back to HTTP
    await act(async () => {
      fixture.emitSocketEvent("close");
    });
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    expect(result.current.status).toBe("confirmed");

    // Late WS processed event arrives
    act(() => {
      fixture.emitWsStatus("processed", { err: null }, { slot: 390 });
    });

    // Must remain confirmed, not regress to processed
    expect(result.current.status).toBe("confirmed");
  });

  // Scenario 17: Switching signatures cancels previous and ignores late responses from old signature
  it("Scenario 17: Switching signatures isolates previous subscription responses", async () => {
    const fixture = createMockStreamingConnection();

    const { result } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
      }),
    );

    expect(result.current.signature).toBe(MOCK_SIGNATURE);

    act(() => {
      result.current.subscribe(MOCK_SIGNATURE_2);
    });

    expect(result.current.signature).toBe(MOCK_SIGNATURE_2);
    expect(result.current.status).toBe("pending");

    // Notification for old signature should not update
    act(() => {
      fixture.emitWsStatus("confirmed", { err: null }, { slot: 500 });
    });

    // The active subscription is MOCK_SIGNATURE_2, which has its own listener callbacks
    expect(result.current.signature).toBe(MOCK_SIGNATURE_2);
  });

  // Scenario 18 & 19 & 20 & 21: Component unmount and cleanup safety
  it("Scenario 18-21: Unmount cleans up listeners, cancels timers, and avoids React state update warnings", async () => {
    const fixture = createMockStreamingConnection();

    const { unmount } = renderHook(() =>
      useEscrowSubscription(MOCK_SIGNATURE, {
        connection: fixture.connection,
      }),
    );

    expect(fixture.connection.onSignatureWithOptions).toHaveBeenCalledTimes(3);

    unmount();

    expect(fixture.connection.removeSignatureListener).toHaveBeenCalledTimes(3);

    // Emitting events after unmount should not throw or cause errors
    expect(() => {
      fixture.emitWsStatus("confirmed", { err: null }, { slot: 600 });
      fixture.emitSocketEvent("close");
    }).not.toThrow();
  });
});
