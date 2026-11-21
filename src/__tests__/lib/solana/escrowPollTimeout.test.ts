/**
 * Tests for the 5 second RPC poll deadline (#7955).
 *
 * A blackholed RPC node never answers and never resets the socket, so the
 * underlying promise stays pending forever. These tests use never-settling
 * mocks and fake timers to prove the polling paths still make progress.
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

import type { Connection } from "@solana/web3.js";
import {
  ESCROW_RPC_POLL_TIMEOUT_MS,
  EscrowRpcTimeoutError,
  reconcilePendingSignature,
  subscribeToEscrowConfirmation,
  withRpcPollTimeout,
} from "@/lib/solana/escrowClient";

const SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJklSzLj699";

const never = () => new Promise<never>(() => {});

describe("withRpcPollTimeout", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("defaults to a 5 second deadline", () => {
    expect(ESCROW_RPC_POLL_TIMEOUT_MS).toBe(5_000);
  });

  it("resolves with the operation result before the deadline", async () => {
    await expect(withRpcPollTimeout(async () => "ok")).resolves.toBe("ok");
  });

  it("rejects with EscrowRpcTimeoutError when the call never settles", async () => {
    const pending = withRpcPollTimeout(never, { endpoint: "node-a" });
    const assertion = expect(pending).rejects.toBeInstanceOf(
      EscrowRpcTimeoutError,
    );

    await jest.advanceTimersByTimeAsync(ESCROW_RPC_POLL_TIMEOUT_MS);
    await assertion;
  });

  it("does not reject before the 5 second mark", async () => {
    let settled = false;
    const pending = withRpcPollTimeout(never).catch(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(ESCROW_RPC_POLL_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it("aborts the signal handed to the operation on timeout", async () => {
    let captured: AbortSignal | undefined;
    const pending = withRpcPollTimeout((signal) => {
      captured = signal;
      return never();
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(
      EscrowRpcTimeoutError,
    );

    expect(captured?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(ESCROW_RPC_POLL_TIMEOUT_MS);
    await assertion;
    expect(captured?.aborted).toBe(true);
  });

  it("clears its timer when the operation settles first", async () => {
    await withRpcPollTimeout(async () => 1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("falls back to the default for invalid timeout values", async () => {
    const pending = withRpcPollTimeout(never, { timeoutMs: Number.NaN });
    const assertion = expect(pending).rejects.toBeInstanceOf(
      EscrowRpcTimeoutError,
    );
    await jest.advanceTimersByTimeAsync(ESCROW_RPC_POLL_TIMEOUT_MS);
    await assertion;
  });
});

describe("reconcilePendingSignature with a blackholed RPC", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("counts a hung call as a retry and gives up after maxRetries", async () => {
    const getSignatureStatus = jest.fn(never);
    const connection = { getSignatureStatus } as unknown as Connection;
    jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = reconcilePendingSignature({
      signature: SIGNATURE,
      connection,
      maxRetries: 3,
      retryIntervalMs: 100,
    });

    await jest.advanceTimersByTimeAsync(3 * (ESCROW_RPC_POLL_TIMEOUT_MS + 100));

    await expect(result).resolves.toBe(false);
    expect(getSignatureStatus).toHaveBeenCalledTimes(3);
  });

  it("still confirms when a later attempt succeeds after a hang", async () => {
    const getSignatureStatus = jest
      .fn()
      .mockImplementationOnce(never)
      .mockResolvedValueOnce({
        value: { err: null, confirmationStatus: "finalized" },
      });
    const connection = { getSignatureStatus } as unknown as Connection;
    jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = reconcilePendingSignature({
      signature: SIGNATURE,
      connection,
      maxRetries: 3,
      retryIntervalMs: 100,
    });

    await jest.advanceTimersByTimeAsync(ESCROW_RPC_POLL_TIMEOUT_MS + 100);

    await expect(result).resolves.toBe(true);
    expect(getSignatureStatus).toHaveBeenCalledTimes(2);
  });
});

describe("subscribeToEscrowConfirmation polling with a blackholed RPC", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("keeps retrying after a hung poll instead of stalling", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const pollSignatureStatus = jest
      .fn()
      .mockImplementationOnce(never)
      .mockResolvedValueOnce({
        slot: 42,
        confirmations: null,
        err: null,
        confirmationStatus: "finalized",
      });

    const subscription = subscribeToEscrowConfirmation(SIGNATURE, {
      connection: {
        onSignatureWithOptions: jest.fn(() => {
          throw new Error("ws unavailable");
        }),
        removeSignatureListener: jest.fn(),
      } as unknown as Connection,
      pollSignatureStatus,
      minPollIntervalMs: 100,
      pollIntervalMs: 100,
      overallTimeoutMs: 60_000,
    });

    await jest.advanceTimersByTimeAsync(ESCROW_RPC_POLL_TIMEOUT_MS + 1_000);

    const event = await subscription.promise;
    expect(event.status).toBe("finalized");
    expect(pollSignatureStatus).toHaveBeenCalledTimes(2);
  });
});
