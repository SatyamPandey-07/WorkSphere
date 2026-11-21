/**
 * Comprehensive tests for WebSocket signature confirmation streaming and
 * monotonic confirmation state machine (#7773).
 *
 * All Solana SDK calls and timers are mocked — no live network interactions.
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

import type { Connection, SignatureStatus } from "@solana/web3.js";
import {
  EscrowConfirmationStateMachine,
  subscribeToEscrowConfirmation,
  EscrowClient,
  EscrowRpcConnectionPool,
  type EscrowConfirmationStatus,
  type EscrowConfirmationEvent,
} from "@/lib/solana/escrowClient";

const MOCK_SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJklSzLj699";

function makeSignatureStatus(
  confirmationStatus: "processed" | "confirmed" | "finalized",
  slot = 1000,
  err: any = null,
): SignatureStatus {
  return {
    slot,
    confirmations: confirmationStatus === "finalized" ? null : 32,
    status: err ? { Err: err } : { Ok: null },
    err,
    confirmationStatus,
  } as SignatureStatus;
}

interface MockConnectionParts {
  onSignatureWithOptions?: jest.Mock;
  removeSignatureListener?: jest.Mock;
  getSignatureStatuses?: jest.Mock;
}

function createMockStreamingConnection(parts: MockConnectionParts = {}) {
  let subCounter = 1;
  const callbacks: Record<
    number,
    {
      callback: (status: any, context: any) => void;
      commitment: string;
    }
  > = {};

  const onSignatureWithOptions =
    parts.onSignatureWithOptions ??
    jest.fn((sig: string, callback: any, options: any) => {
      const id = subCounter++;
      callbacks[id] = { callback, commitment: options.commitment };
      return id;
    });

  const removeSignatureListener =
    parts.removeSignatureListener ??
    jest.fn((id: number) => {
      delete callbacks[id];
      return Promise.resolve();
    });

  const getSignatureStatuses =
    parts.getSignatureStatuses ??
    jest.fn().mockResolvedValue({ value: [null] });

  const connection = {
    onSignatureWithOptions,
    removeSignatureListener,
    getSignatureStatuses,
  } as unknown as Connection;

  return {
    connection,
    onSignatureWithOptions,
    removeSignatureListener,
    getSignatureStatuses,
    callbacks,
    emitSignature: (
      commitment: "processed" | "confirmed" | "finalized",
      status: any,
      context = { slot: 1234 },
    ) => {
      for (const entry of Object.values(callbacks)) {
        if (entry.commitment === commitment) {
          entry.callback(status, context);
        }
      }
    },
  };
}

function createMockPool(conn: Connection): EscrowRpcConnectionPool {
  return {
    getActiveConnection: jest.fn().mockResolvedValue(conn),
    getConnection: jest.fn().mockResolvedValue(conn),
    execute: jest.fn(async (operation: (c: Connection) => any) => {
      return operation(conn);
    }),
  } as unknown as EscrowRpcConnectionPool;
}

describe("EscrowConfirmationStateMachine (#7773)", () => {
  it("initializes with status 'pending'", () => {
    const sm = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    expect(sm.getStatus()).toBe("pending");
    expect(sm.isTerminal()).toBe(false);
  });

  it("transitions monotonically: pending -> processed -> confirmed -> finalized", () => {
    const sm = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    const history: EscrowConfirmationStatus[] = [];
    sm.subscribe((event) => history.push(event.status));

    expect(sm.transition("processed", { slot: 100 })).not.toBeNull();
    expect(sm.getStatus()).toBe("processed");

    expect(sm.transition("confirmed", { slot: 105 })).not.toBeNull();
    expect(sm.getStatus()).toBe("confirmed");

    expect(sm.transition("finalized", { slot: 137 })).not.toBeNull();
    expect(sm.getStatus()).toBe("finalized");
    expect(sm.isTerminal()).toBe(true);

    expect(history).toEqual(["processed", "confirmed", "finalized"]);
  });

  it("permits forward jumps (e.g. pending -> confirmed or pending -> finalized)", () => {
    const sm1 = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    expect(sm1.transition("confirmed", { slot: 105 })).not.toBeNull();
    expect(sm1.getStatus()).toBe("confirmed");

    const sm2 = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    expect(sm2.transition("finalized", { slot: 137 })).not.toBeNull();
    expect(sm2.getStatus()).toBe("finalized");
  });

  it("strictly prevents status regression (confirmed -> processed is rejected)", () => {
    const sm = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    sm.transition("confirmed", { slot: 105 });

    // Late arriving 'processed' notification must not regress state
    expect(sm.transition("processed", { slot: 99 })).toBeNull();
    expect(sm.getStatus()).toBe("confirmed");
  });

  it("ignores duplicate status transitions without firing duplicate listener calls", () => {
    const sm = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    const listener = jest.fn();
    sm.subscribe(listener);

    sm.transition("confirmed", { slot: 105 });
    expect(listener).toHaveBeenCalledTimes(1);

    // Duplicate notification
    expect(sm.transition("confirmed", { slot: 106 })).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("handles fallback_polling transition without regressing forward progression", () => {
    const sm = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    sm.transition("processed", { slot: 100 });
    expect(sm.transition("fallback_polling", { reason: "watchdog_timeout" })).not.toBeNull();
    expect(sm.getStatus()).toBe("fallback_polling");

    // From fallback_polling, forward progression to confirmed is valid
    expect(sm.transition("confirmed", { slot: 105 })).not.toBeNull();
    expect(sm.getStatus()).toBe("confirmed");
  });

  it("handles terminal states 'failed' and 'timeout' and blocks subsequent transitions", () => {
    const smFail = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    expect(smFail.transition("failed", { error: "Transaction simulation failed" })).not.toBeNull();
    expect(smFail.isTerminal()).toBe(true);
    expect(smFail.transition("confirmed")).toBeNull();
    expect(smFail.getStatus()).toBe("failed");

    const smTimeout = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    expect(smTimeout.transition("timeout", { error: "Confirmation budget exceeded" })).not.toBeNull();
    expect(smTimeout.isTerminal()).toBe(true);
    expect(smTimeout.transition("finalized")).toBeNull();
    expect(smTimeout.getStatus()).toBe("timeout");
  });

  it("blocks any transition once 'finalized' is reached", () => {
    const sm = new EscrowConfirmationStateMachine(MOCK_SIGNATURE);
    sm.transition("finalized", { slot: 200 });
    expect(sm.isTerminal()).toBe(true);

    expect(sm.transition("failed", { error: "late error" })).toBeNull();
    expect(sm.transition("fallback_polling")).toBeNull();
    expect(sm.getStatus()).toBe("finalized");
  });
});

describe("subscribeToEscrowConfirmation (#7773)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("subscribes to processed, confirmed, and finalized commitments via Web3.js", () => {
    const mock = createMockStreamingConnection();
    const pool = createMockPool(mock.connection);

    const subscription = subscribeToEscrowConfirmation(MOCK_SIGNATURE, {
      pool,
      connection: mock.connection,
    });
    expect(mock.onSignatureWithOptions).toHaveBeenCalledTimes(3);

    const commitments = mock.onSignatureWithOptions.mock.calls.map(
      (c) => c[2].commitment,
    );
    expect(commitments).toContain("processed");
    expect(commitments).toContain("confirmed");
    expect(commitments).toContain("finalized");

    subscription.unsubscribe();
  });

  it("streams processed -> confirmed -> finalized events as WebSocket notifications fire", () => {
    const mock = createMockStreamingConnection();
    const pool = createMockPool(mock.connection);

    const events: EscrowConfirmationEvent[] = [];
    const onFinalized = jest.fn();

    const subscription = subscribeToEscrowConfirmation(MOCK_SIGNATURE, {
      pool,
      connection: mock.connection,
      callbacks: {
        onStatusChange: (e) => events.push(e),
        onFinalized,
      },
    });

    // 1. WS emits processed
    mock.emitSignature("processed", { err: null }, { slot: 100 });
    expect(events.length).toBe(1);
    expect(events[0].status).toBe("processed");
    expect(events[0].source).toBe("websocket");

    // 2. WS emits confirmed
    mock.emitSignature("confirmed", { err: null }, { slot: 105 });
    expect(events.length).toBe(2);
    expect(events[1].status).toBe("confirmed");
    expect(events[1].source).toBe("websocket");

    // 3. WS emits finalized
    mock.emitSignature("finalized", { err: null }, { slot: 137 });
    expect(events.length).toBe(3);
    expect(events[2].status).toBe("finalized");
    expect(events[2].source).toBe("websocket");
    expect(onFinalized).toHaveBeenCalledTimes(1);

    expect(subscription.getStatus()).toBe("finalized");
    subscription.unsubscribe();
  });

  it("triggers 30-second confirmation watchdog and falls back to HTTP polling if WS is silent", async () => {
    const mock = createMockStreamingConnection();
    const pool = createMockPool(mock.connection);

    // Mock HTTP polling response returning confirmed status at slot 102
    mock.getSignatureStatuses.mockResolvedValue({
      value: [makeSignatureStatus("confirmed", 102)],
    });

    const events: EscrowConfirmationEvent[] = [];
    const subscription = subscribeToEscrowConfirmation(MOCK_SIGNATURE, {
      pool,
      connection: mock.connection,
      confirmationTimeoutMs: 30_000,
      callbacks: {
        onStatusChange: (e) => events.push(e),
      },
    });

    // Advance 29s - watchdog should not have fired yet
    jest.advanceTimersByTime(29_000);
    expect(subscription.getStatus()).toBe("pending");

    // Advance past 30s threshold
    jest.advanceTimersByTime(1_500);

    // Watchdog fires: state switches to fallback_polling
    expect(subscription.getStatus()).toBe("fallback_polling");
    expect(events.some((e) => e.status === "fallback_polling")).toBe(true);

    // Let HTTP poll run
    await Promise.resolve();
    await Promise.resolve();

    expect(mock.getSignatureStatuses).toHaveBeenCalledWith([MOCK_SIGNATURE], {
      searchTransactionHistory: true,
    });

    subscription.unsubscribe();
  });

  it("triggers 15-second post-confirmation finalization watchdog if WS stalls after confirmed", async () => {
    const mock = createMockStreamingConnection();
    const pool = createMockPool(mock.connection);

    mock.getSignatureStatuses.mockResolvedValue({
      value: [makeSignatureStatus("finalized", 140)],
    });

    const events: EscrowConfirmationEvent[] = [];
    const onFinalized = jest.fn();

    const subscription = subscribeToEscrowConfirmation(MOCK_SIGNATURE, {
      pool,
      connection: mock.connection,
      finalizationTimeoutMs: 15_000,
      callbacks: {
        onStatusChange: (e) => events.push(e),
        onFinalized,
      },
    });

    // 1. WebSocket delivers confirmed at 5s
    jest.advanceTimersByTime(5_000);
    mock.emitSignature("confirmed", { err: null }, { slot: 105 });
    expect(subscription.getStatus()).toBe("confirmed");

    // 2. WS stalls; advance 15s after confirmed was reached
    jest.advanceTimersByTime(15_500);

    // Post-confirmation watchdog fires, starting HTTP polling
    expect(subscription.getStatus()).toBe("fallback_polling");

    // Advance timers for polling interval
    jest.advanceTimersByTime(2_500);
    await Promise.resolve();
    await Promise.resolve();

    expect(mock.getSignatureStatuses).toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it("accepts late WebSocket notification even during fallback_polling", () => {
    const mock = createMockStreamingConnection();
    const pool = createMockPool(mock.connection);

    const subscription = subscribeToEscrowConfirmation(MOCK_SIGNATURE, {
      pool,
      connection: mock.connection,
      confirmationTimeoutMs: 10_000,
    });

    // Trigger fallback_polling
    jest.advanceTimersByTime(11_000);
    expect(subscription.getStatus()).toBe("fallback_polling");

    // Late WS notification arrives with finalized
    mock.emitSignature("finalized", { err: null }, { slot: 142 });
    expect(subscription.getStatus()).toBe("finalized");

    subscription.unsubscribe();
  });

  it("handles on-chain errors and transitions to 'failed'", () => {
    const mock = createMockStreamingConnection();
    const pool = createMockPool(mock.connection);

    const onError = jest.fn();
    const subscription = subscribeToEscrowConfirmation(MOCK_SIGNATURE, {
      pool,
      connection: mock.connection,
      callbacks: { onError },
    });

    mock.emitSignature(
      "confirmed",
      { err: { InstructionError: [0, "Custom: 1"] } },
      { slot: 101 },
    );

    expect(subscription.getStatus()).toBe("failed");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("InstructionError"),
      }),
      expect.anything(),
    );

    subscription.unsubscribe();
  });

  it("triggers overall timeout when budget is exceeded", () => {
    const mock = createMockStreamingConnection();
    const pool = createMockPool(mock.connection);

    const onTimeout = jest.fn();
    const subscription = subscribeToEscrowConfirmation(MOCK_SIGNATURE, {
      pool,
      connection: mock.connection,
      overallTimeoutMs: 50_000,
      callbacks: { onTimeout },
    });

    jest.advanceTimersByTime(50_500);
    expect(subscription.getStatus()).toBe("timeout");
    expect(onTimeout).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
  });

  it("cleans up all listeners and timers on unsubscribe()", () => {
    const mock = createMockStreamingConnection();
    const pool = createMockPool(mock.connection);

    const subscription = subscribeToEscrowConfirmation(MOCK_SIGNATURE, {
      pool,
      connection: mock.connection,
    });
    expect(mock.onSignatureWithOptions).toHaveBeenCalledTimes(3);

    subscription.unsubscribe();
    expect(mock.removeSignatureListener).toHaveBeenCalledTimes(3);
  });

  it("EscrowClient.subscribeToConfirmation integrates properly with subscribeToEscrowConfirmation", () => {
    const mock = createMockStreamingConnection();
    const pool = createMockPool(mock.connection);

    const client = new EscrowClient({ pool });
    const subscription = client.subscribeToConfirmation(MOCK_SIGNATURE, {
      connection: mock.connection,
    });

    expect(mock.onSignatureWithOptions).toHaveBeenCalledTimes(3);
    expect(subscription.getStatus()).toBe("pending");
    subscription.unsubscribe();
  });
});
