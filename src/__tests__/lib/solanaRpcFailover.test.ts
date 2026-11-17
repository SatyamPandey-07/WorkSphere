/**
 * solanaRpcFailover.test.ts
 * Tests RPC connection pooling, exponential backoff, and failover (#5364).
 */

import type { Connection, SignatureStatus } from "@solana/web3.js";
import {
  SolanaRpcConnectionPool,
  SolanaRpcFailoverError,
  computeSolanaRpcBackoffDelay,
  isRetryableSolanaRpcError,
  resolveSolanaRpcEndpoints,
  verifySolanaPayment,
} from "@/lib/payments/solanaPay";

const VALID_SIGNATURE = "A".repeat(88);

function createFakeConnection(
  handler: () => Promise<unknown>,
): { connection: Connection; getSignatureStatuses: jest.Mock } {
  const getSignatureStatuses = jest.fn(handler);
  return {
    connection: { getSignatureStatuses } as unknown as Connection,
    getSignatureStatuses,
  };
}

function rpcResponse(status: SignatureStatus | null) {
  return {
    context: { slot: 1 },
    value: [status],
  };
}

function statusError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe("resolveSolanaRpcEndpoints (#5364)", () => {
  it("merges, splits, and de-duplicates RPC endpoints from the environment", () => {
    const env = {
      SOLANA_RPC_URLS: "https://a.example, https://b.example\nhttps://a.example",
      SOLANA_RPC_URL: "https://c.example",
      SOLANA_RPC_FALLBACK_URLS: "not-a-url, https://d.example",
    } as unknown as NodeJS.ProcessEnv;

    expect(resolveSolanaRpcEndpoints(env)).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
      "https://d.example",
    ]);
  });

  it("returns an empty list when no valid endpoints are configured", () => {
    expect(resolveSolanaRpcEndpoints({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("computeSolanaRpcBackoffDelay (#5364)", () => {
  it("grows exponentially and caps at maxDelayMs", () => {
    expect(computeSolanaRpcBackoffDelay(0, 100, 1_000, 0, () => 0)).toBe(100);
    expect(computeSolanaRpcBackoffDelay(1, 100, 1_000, 0, () => 0)).toBe(200);
    expect(computeSolanaRpcBackoffDelay(2, 100, 1_000, 0, () => 0)).toBe(400);
    expect(computeSolanaRpcBackoffDelay(10, 100, 1_000, 0, () => 0)).toBe(1_000);
  });

  it("adds bounded jitter on top of the exponential delay", () => {
    // 200ms base + 50% jitter at random()=1 => 300ms
    expect(computeSolanaRpcBackoffDelay(1, 100, 1_000, 0.5, () => 1)).toBe(300);
  });
});

describe("isRetryableSolanaRpcError (#5364)", () => {
  it("treats rate limiting and gateway failures as retryable", () => {
    expect(isRetryableSolanaRpcError({ status: 429 })).toBe(true);
    expect(isRetryableSolanaRpcError(statusError(503, "Service Unavailable"))).toBe(true);
    expect(isRetryableSolanaRpcError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRetryableSolanaRpcError(new Error("fetch failed"))).toBe(true);
  });

  it("leaves deterministic request errors non-retryable", () => {
    expect(isRetryableSolanaRpcError(new Error("Invalid signature"))).toBe(false);
    expect(isRetryableSolanaRpcError({ status: 400 })).toBe(false);
  });
});

describe("SolanaRpcConnectionPool (#5364)", () => {
  it("retries the same endpoint with backoff before succeeding", async () => {
    let primaryCalls = 0;
    const sleep = jest.fn().mockResolvedValue(undefined);

    const primary = createFakeConnection(async () => {
      primaryCalls += 1;
      if (primaryCalls === 1) {
        throw statusError(429, "Too Many Requests");
      }
      return rpcResponse({
        slot: 7,
        confirmations: 2,
        err: null,
        confirmationStatus: "confirmed",
      });
    });
    const secondary = createFakeConnection(async () =>
      rpcResponse({
        slot: 8,
        confirmations: 2,
        err: null,
        confirmationStatus: "confirmed",
      }),
    );

    const pool = new SolanaRpcConnectionPool(
      {
        endpoints: ["https://primary", "https://secondary"],
        maxRetriesPerEndpoint: 1,
        baseDelayMs: 10,
        maxDelayMs: 100,
      },
      {
        sleep,
        random: () => 0,
        createConnection: (endpoint) =>
          endpoint === "https://primary"
            ? primary.connection
            : secondary.connection,
      },
    );

    const result = await pool.execute((connection) =>
      connection.getSignatureStatuses([VALID_SIGNATURE], {
        searchTransactionHistory: true,
      }),
    );

    expect(result.value[0]?.slot).toBe(7);
    expect(primaryCalls).toBe(2);
    expect(secondary.getSignatureStatuses).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("fails over to the secondary endpoint when the primary is unavailable", async () => {
    const primary = createFakeConnection(async () => {
      throw statusError(503, "Service Unavailable");
    });
    const secondary = createFakeConnection(async () =>
      rpcResponse({
        slot: 42,
        confirmations: 3,
        err: null,
        confirmationStatus: "confirmed",
      }),
    );

    const pool = new SolanaRpcConnectionPool(
      {
        endpoints: ["https://primary", "https://secondary"],
        maxRetriesPerEndpoint: 0,
      },
      {
        sleep: jest.fn().mockResolvedValue(undefined),
        createConnection: (endpoint) =>
          endpoint === "https://primary"
            ? primary.connection
            : secondary.connection,
      },
    );

    const result = await pool.execute((connection) =>
      connection.getSignatureStatuses([VALID_SIGNATURE], {
        searchTransactionHistory: true,
      }),
    );

    expect(result.value[0]?.slot).toBe(42);
    expect(primary.getSignatureStatuses).toHaveBeenCalledTimes(1);
    expect(secondary.getSignatureStatuses).toHaveBeenCalledTimes(1);
    expect(pool.getActiveEndpoint()).toBe("https://secondary");
  });

  it("throws only after exhausting every endpoint", async () => {
    const primary = createFakeConnection(async () => {
      throw statusError(503, "Service Unavailable");
    });
    const secondary = createFakeConnection(async () => {
      throw statusError(429, "Too Many Requests");
    });

    const pool = new SolanaRpcConnectionPool(
      {
        endpoints: ["https://primary", "https://secondary"],
        maxRetriesPerEndpoint: 0,
      },
      {
        sleep: jest.fn().mockResolvedValue(undefined),
        createConnection: (endpoint) =>
          endpoint === "https://primary"
            ? primary.connection
            : secondary.connection,
      },
    );

    await expect(
      pool.execute((connection) =>
        connection.getSignatureStatuses([VALID_SIGNATURE], {
          searchTransactionHistory: true,
        }),
      ),
    ).rejects.toMatchObject({
      name: "SolanaRpcFailoverError",
      attempts: [
        { endpoint: "https://primary" },
        { endpoint: "https://secondary" },
      ],
    });
  });

  it("does not retry non-retryable errors on the same endpoint but still fails over", async () => {
    const primary = createFakeConnection(async () => {
      throw new Error("Invalid request parameters");
    });
    const secondary = createFakeConnection(async () =>
      rpcResponse({
        slot: 5,
        confirmations: 1,
        err: null,
        confirmationStatus: "confirmed",
      }),
    );

    const pool = new SolanaRpcConnectionPool(
      {
        endpoints: ["https://primary", "https://secondary"],
        maxRetriesPerEndpoint: 3,
      },
      {
        sleep: jest.fn().mockResolvedValue(undefined),
        createConnection: (endpoint) =>
          endpoint === "https://primary"
            ? primary.connection
            : secondary.connection,
      },
    );

    const result = await pool.execute((connection) =>
      connection.getSignatureStatuses([VALID_SIGNATURE], {
        searchTransactionHistory: true,
      }),
    );

    expect(result.value[0]?.slot).toBe(5);
    expect(primary.getSignatureStatuses).toHaveBeenCalledTimes(1);
  });
});

describe("verifySolanaPayment (#5364)", () => {
  function poolWith(connection: Connection) {
    return new SolanaRpcConnectionPool(
      { endpoints: ["https://rpc.example"] },
      { createConnection: () => connection },
    );
  }

  it("reports CONFIRMED with slot and confirmation status", async () => {
    const { connection } = createFakeConnection(async () =>
      rpcResponse({
        slot: 99,
        confirmations: 12,
        err: null,
        confirmationStatus: "finalized",
      }),
    );

    const result = await verifySolanaPayment(VALID_SIGNATURE, {
      pool: poolWith(connection),
    });

    expect(result.status).toBe("CONFIRMED");
    expect(result.slot).toBe(99);
    expect(result.confirmationStatus).toBe("finalized");
  });

  it("reports PENDING when the transaction is not found yet", async () => {
    const { connection } = createFakeConnection(async () => rpcResponse(null));

    const result = await verifySolanaPayment(VALID_SIGNATURE, {
      pool: poolWith(connection),
    });

    expect(result.status).toBe("PENDING");
  });

  it("reports PENDING when the transaction is only processed", async () => {
    const { connection } = createFakeConnection(async () =>
      rpcResponse({
        slot: 12,
        confirmations: 0,
        err: null,
        confirmationStatus: "processed",
      }),
    );

    const result = await verifySolanaPayment(VALID_SIGNATURE, {
      pool: poolWith(connection),
    });

    expect(result.status).toBe("PENDING");
  });

  it("reports FAILED when the transaction landed with an error", async () => {
    const { connection } = createFakeConnection(async () =>
      rpcResponse({
        slot: 12,
        confirmations: 1,
        err: { InstructionError: [0, "Custom"] },
        confirmationStatus: "confirmed",
      }),
    );

    const result = await verifySolanaPayment(VALID_SIGNATURE, {
      pool: poolWith(connection),
    });

    expect(result.status).toBe("FAILED");
    expect(result.error).toBeDefined();
  });

  it("rejects malformed signatures without touching the RPC", async () => {
    const { connection, getSignatureStatuses } = createFakeConnection(async () =>
      rpcResponse(null),
    );

    const result = await verifySolanaPayment("not-a-signature", {
      pool: poolWith(connection),
    });

    expect(result.status).toBe("FAILED");
    expect(getSignatureStatuses).not.toHaveBeenCalled();
  });

  it("throws SolanaRpcFailoverError when every endpoint is exhausted", async () => {
    const { connection } = createFakeConnection(async () => {
      throw statusError(503, "Service Unavailable");
    });

    await expect(
      verifySolanaPayment(VALID_SIGNATURE, { pool: poolWith(connection) }),
    ).rejects.toBeInstanceOf(SolanaRpcFailoverError);
  });
});
