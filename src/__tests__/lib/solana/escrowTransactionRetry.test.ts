/**
 * Comprehensive test suite for EscrowTransactionRetryPipeline and Compute Budget injection (#7848).
 */

// Fix jsdom Buffer vs Uint8Array realm mismatch for @solana/web3.js & @noble/hashes
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

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: false,
  writable: true,
});

Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: () => "mock-uuid-1234",
    getRandomValues: (arr: any) => arr,
  },
  writable: false,
  configurable: true,
});

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  EscrowTransactionRetryPipeline,
  injectOrUpdateComputeUnitPrice,
  isComputeBudgetInstruction,
} from "@/lib/solana/escrowTransactionRetry";

const MOCK_SIGNATURE_1 =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJklSzLj699";
const MOCK_SIGNATURE_2 =
  "3ABCv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJklSzLj222";
const MOCK_SIGNATURE_3 =
  "4DEFv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJklSzLj333";

describe("EscrowTransactionRetryPipeline (#7848)", () => {
  let subCounter: number;
  let callbacks: Record<
    number,
    {
      callback: (status: any, context: any) => void;
      commitment: string;
      signature: string;
    }
  >;
  let mockConnection: Partial<Connection>;

  beforeEach(() => {
    jest.useFakeTimers();
    subCounter = 1;
    callbacks = {};

    const onSignatureWithOptions = jest.fn(
      (sig: string, callback: any, options: any) => {
        const id = subCounter++;
        callbacks[id] = {
          callback,
          commitment: options.commitment,
          signature: sig,
        };
        return id;
      },
    );

    const removeSignatureListener = jest.fn((id: number) => {
      delete callbacks[id];
      return Promise.resolve();
    });

    const getSignatureStatuses = jest
      .fn()
      .mockResolvedValue({ value: [null] });

    const getRecentPrioritizationFees = jest.fn().mockResolvedValue([
      { prioritizationFee: 10_000 },
    ]);

    const getBlockHeight = jest.fn().mockResolvedValue(1000);

    mockConnection = {
      rpcEndpoint: "https://api.devnet.solana.com",
      onSignatureWithOptions,
      removeSignatureListener,
      getSignatureStatuses,
      getRecentPrioritizationFees,
      getBlockHeight,
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const emitWsStatus = (
    sig: string,
    commitment: "processed" | "confirmed" | "finalized",
    status: any,
    context = { slot: 1000 },
  ) => {
    for (const entry of Object.values(callbacks)) {
      if (entry.commitment === commitment && entry.signature === sig) {
        entry.callback(status, context);
      }
    }
  };

  describe("Compute Budget instruction injection (#7848)", () => {
    it("Test 12: detects ComputeBudgetProgram instructions accurately", () => {
      const priceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 10_000,
      });
      const limitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 200_000,
      });
      const transferIx = SystemProgram.transfer({
        fromPubkey: Keypair.generate().publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 100,
      });

      expect(isComputeBudgetInstruction(priceIx)).toBe(true);
      expect(isComputeBudgetInstruction(priceIx, 3)).toBe(true);
      expect(isComputeBudgetInstruction(priceIx, 2)).toBe(false);
      expect(isComputeBudgetInstruction(limitIx, 2)).toBe(true);
      expect(isComputeBudgetInstruction(transferIx)).toBe(false);
    });

    it("Test 13: injects setComputeUnitPrice instruction at the head of the transaction", () => {
      const tx = new Transaction();
      const transferIx = SystemProgram.transfer({
        fromPubkey: Keypair.generate().publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 100,
      });
      tx.add(transferIx);

      injectOrUpdateComputeUnitPrice(tx, 25_000);

      expect(tx.instructions.length).toBe(2);
      expect(isComputeBudgetInstruction(tx.instructions[0], 3)).toBe(true);
      expect(tx.instructions[1]).toBe(transferIx);
    });

    it("Test 14: updates existing setComputeUnitPrice instruction without adding duplicates", () => {
      const tx = new Transaction();
      injectOrUpdateComputeUnitPrice(tx, 10_000);
      expect(tx.instructions.length).toBe(1);

      injectOrUpdateComputeUnitPrice(tx, 50_000);
      expect(tx.instructions.length).toBe(1);
      expect(isComputeBudgetInstruction(tx.instructions[0], 3)).toBe(true);
    });

    it("Test 14b: rejects non-legacy transaction or invalid object with typed TypeError", () => {
      expect(() => {
        injectOrUpdateComputeUnitPrice({} as any, 10_000);
      }).toThrow(TypeError);
    });
  });

  describe("Retry pipeline execution & Stepped fee bumps (#7848)", () => {
    it("Test 15: calculates stepped fees with multiplier and bounds", () => {
      const pipeline = new EscrowTransactionRetryPipeline(
        mockConnection as Connection,
        {
          minMicroLamports: 1_000,
          maxMicroLamports: 100_000,
          feeBumpMultiplier: 1.5,
        },
      );

      expect(pipeline.calculateSteppedFee(10_000, 1)).toBe(10_000); // 1st attempt = base
      expect(pipeline.calculateSteppedFee(10_000, 2)).toBe(15_000); // 2nd attempt = 10,000 * 1.5
      expect(pipeline.calculateSteppedFee(10_000, 3)).toBe(22_500); // 3rd attempt = 15,000 * 1.5
      expect(pipeline.calculateSteppedFee(80_000, 2)).toBe(100_000); // Clamped at max 100,000
    });

    it("Test 16: successful confirmation on first attempt completes without retries", async () => {
      const pipeline = new EscrowTransactionRetryPipeline(
        mockConnection as Connection,
      );

      const builder = jest.fn(async () => new Transaction());
      const signer = jest.fn(async () => {
        setTimeout(() => {
          emitWsStatus(
            MOCK_SIGNATURE_1,
            "confirmed",
            { err: null },
            { slot: 500 },
          );
        }, 10);
        return {
          signature: MOCK_SIGNATURE_1,
          recentBlockhash: "abc",
          lastValidBlockHeight: 1100,
        };
      });

      const executePromise = pipeline.executeEscrowWithRetry({
        bookingId: "booking-101",
        builder,
        signer,
      });

      await jest.advanceTimersByTimeAsync(20);

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.signature).toBe(MOCK_SIGNATURE_1);
      expect(result.attempts).toBe(1);
      expect(signer).toHaveBeenCalledTimes(1);
    });

    it("Test 17: stepped replacement retry when initial attempt times out and blockhash has expired", async () => {
      const pipeline = new EscrowTransactionRetryPipeline(
        mockConnection as Connection,
        {
          maxRetries: 2,
          attemptConfirmationTimeoutMs: 5_000,
          retryDelayMs: 100,
          feeBumpMultiplier: 2.0,
        },
      );

      const signatures = [MOCK_SIGNATURE_1, MOCK_SIGNATURE_2];
      let callCount = 0;

      // Ensure block height exceeds lastValidBlockHeight (1050 > 1000)
      (mockConnection.getBlockHeight as jest.Mock).mockResolvedValue(1050);

      const builder = jest.fn(async () => new Transaction());
      const signer = jest.fn(async () => {
        const sig = signatures[callCount++] || MOCK_SIGNATURE_3;
        if (sig === MOCK_SIGNATURE_2) {
          setTimeout(() => {
            emitWsStatus(
              MOCK_SIGNATURE_2,
              "confirmed",
              { err: null },
              { slot: 510 },
            );
          }, 10);
        }
        return {
          signature: sig,
          recentBlockhash: "bh-" + sig,
          lastValidBlockHeight: 1000,
        };
      });

      const progressStatuses: string[] = [];
      const executePromise = pipeline.executeEscrowWithRetry({
        bookingId: "booking-102",
        builder,
        signer,
        onProgress: (ctx) => progressStatuses.push(ctx.status),
      });

      // Advance clock past attempt 1 timeout (5000ms) + retry delay (100ms) + attempt 2 confirmation (10ms)
      await jest.advanceTimersByTimeAsync(5_500);

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.signature).toBe(MOCK_SIGNATURE_2);
      expect(result.attempts).toBe(2);
      expect(signer).toHaveBeenCalledTimes(2);
      expect(result.allSignatures).toEqual([MOCK_SIGNATURE_1, MOCK_SIGNATURE_2]);
    });

    it("Test 17b: blocks replacement if previous blockhash has not expired (prevents duplicate execution)", async () => {
      const pipeline = new EscrowTransactionRetryPipeline(
        mockConnection as Connection,
        {
          maxRetries: 2,
          attemptConfirmationTimeoutMs: 5_000,
        },
      );

      // Block height (950) is less than lastValidBlockHeight (1000) -> still pending!
      (mockConnection.getBlockHeight as jest.Mock).mockResolvedValue(950);

      const builder = jest.fn(async () => new Transaction());
      const signer = jest.fn(async () => ({
        signature: MOCK_SIGNATURE_1,
        recentBlockhash: "bh-1",
        lastValidBlockHeight: 1000,
      }));

      const executePromise = pipeline.executeEscrowWithRetry({
        bookingId: "booking-pending",
        builder,
        signer,
      });

      await jest.advanceTimersByTimeAsync(5_500);

      const result = await executePromise;
      expect(result.success).toBe(false);
      expect(result.unresolved).toBe(true);
      expect(result.error).toContain("is still pending on-chain");
      expect(signer).toHaveBeenCalledTimes(1); // Crucial: DID NOT submit replacement attempt!
    });

    it("Test 17c: blocks replacement if RPC status check is indeterminate (prevents duplicate execution)", async () => {
      const pipeline = new EscrowTransactionRetryPipeline(
        mockConnection as Connection,
        {
          maxRetries: 2,
          attemptConfirmationTimeoutMs: 5_000,
        },
      );

      (mockConnection.getSignatureStatuses as jest.Mock).mockRejectedValue(
        new Error("503 Service Unavailable"),
      );

      const builder = jest.fn(async () => new Transaction());
      const signer = jest.fn(async () => ({
        signature: MOCK_SIGNATURE_1,
        recentBlockhash: "bh-1",
        lastValidBlockHeight: 1000,
      }));

      const executePromise = pipeline.executeEscrowWithRetry({
        bookingId: "booking-unknown",
        builder,
        signer,
      });

      await jest.advanceTimersByTimeAsync(5_500);

      const result = await executePromise;
      expect(result.success).toBe(false);
      expect(result.unresolved).toBe(true);
      expect(result.error).toContain("RPC status indeterminate");
      expect(signer).toHaveBeenCalledTimes(1); // Crucial: DID NOT submit replacement attempt!
    });

    it("Test 18: halts retries immediately on on-chain execution failure", async () => {
      const pipeline = new EscrowTransactionRetryPipeline(
        mockConnection as Connection,
        {
          maxRetries: 3,
        },
      );

      const builder = jest.fn(async () => new Transaction());
      const signer = jest.fn(async () => {
        setTimeout(() => {
          emitWsStatus(
            MOCK_SIGNATURE_1,
            "confirmed",
            { err: { InstructionError: [0, "CustomProgramError"] } },
            { slot: 520 },
          );
        }, 10);
        return { signature: MOCK_SIGNATURE_1 };
      });

      const executePromise = pipeline.executeEscrowWithRetry({
        bookingId: "booking-103",
        builder,
        signer,
      });

      await jest.advanceTimersByTimeAsync(20);

      const result = await executePromise;
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(signer).toHaveBeenCalledTimes(1);
      expect(result.error).toContain("CustomProgramError");
    });

    it("Test 19: previous transaction confirmed during retry evaluation avoids resubmission", async () => {
      const pipeline = new EscrowTransactionRetryPipeline(
        mockConnection as Connection,
        {
          maxRetries: 2,
          attemptConfirmationTimeoutMs: 5_000,
          retryDelayMs: 500,
        },
      );

      const builder = jest.fn(async () => new Transaction());
      const signer = jest.fn(async () => ({ signature: MOCK_SIGNATURE_1 }));

      (mockConnection.getSignatureStatuses as jest.Mock).mockResolvedValue({
        value: [
          {
            slot: 550,
            confirmations: 30,
            err: null,
            confirmationStatus: "confirmed",
          },
        ],
      });

      const executePromise = pipeline.executeEscrowWithRetry({
        bookingId: "booking-104",
        builder,
        signer,
      });

      await jest.advanceTimersByTimeAsync(5_200);

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.signature).toBe(MOCK_SIGNATURE_1);
      expect(result.confirmedSlot).toBe(550);
      expect(signer).toHaveBeenCalledTimes(1);
    });

    it("Test 20: deterministic simulation error stops retries without resubmission", async () => {
      const pipeline = new EscrowTransactionRetryPipeline(
        mockConnection as Connection,
        {
          maxRetries: 3,
        },
      );

      const builder = jest.fn(async () => new Transaction());
      const signer = jest.fn(async () => {
        throw new Error(
          "Transaction simulation failed: insufficient funds for lamports",
        );
      });

      const result = await pipeline.executeEscrowWithRetry({
        bookingId: "booking-105",
        builder,
        signer,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(signer).toHaveBeenCalledTimes(1);
      expect(result.error).toContain("insufficient funds");
    });
  });
});
