/**
 * Tests for the escrow RPC connection pool failover and optimistic client
 * confirmation with background status polling (#7529).
 *
 * All Solana SDK calls are mocked â€” no real network or wallet interactions.
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
  EscrowRpcConnectionPool,
  EscrowClient,
  EscrowRpcFailoverError,
  EscrowRpcTimeoutError,
  ESCROW_RPC_DEFAULT_ENDPOINT,
  computeEscrowRpcBackoffDelay,
  isEscrowRpcRetryableError,
  resolveEscrowRpcEndpoints,
  getEscrowRpcPool,
  resetEscrowRpcPool,
  getEscrowClient,
  resetEscrowClient,
  simulateEscrowTransaction,
  type QuorumTelemetryRecord,
} from "@/lib/solana/escrowClient";
import { SolanaPayEscrowManager } from "@/lib/solana/solanaPayEscrow";

const PRIMARY = "https://rpc-primary.example.com";
const SECONDARY = "https://rpc-secondary.example.com";
const TERTIARY = "https://rpc-tertiary.example.com";

type ScriptedStatuses = Array<SignatureStatus | null>;

function makeStatus(
  confirmationStatus: "confirmed" | "finalized" | "processed",
  slot = 1234,
): SignatureStatus {
  return {
    slot,
    confirmations: confirmationStatus === "finalized" ? null : 32,
    status: "Confirmed",
    err: null,
    confirmationStatus,
  } as SignatureStatus;
}

function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

interface MockConnectionParts {
  getLatestBlockhash?: jest.Mock;
  getSignatureStatuses?: jest.Mock;
  onSignatureWithOptions?: jest.Mock;
  removeSignatureListener?: jest.Mock;
}

function createMockConnection(
  parts: MockConnectionParts = {},
): Connection & MockConnectionParts {
  return {
    getLatestBlockhash:
      parts.getLatestBlockhash ??
      jest.fn().mockResolvedValue({
        blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
        lastValidBlockHeight: 200_000,
      }),
    getSignatureStatuses:
      parts.getSignatureStatuses ??
      jest.fn().mockResolvedValue({ value: [null] }),
    onSignatureWithOptions: parts.onSignatureWithOptions,
    removeSignatureListener: parts.removeSignatureListener,
  } as unknown as Connection & MockConnectionParts;
}

function buildPool(
  endpoints: string[] = [PRIMARY, SECONDARY],
  connections: Record<string, Connection>,
  config: {
    requestTimeoutMs?: number;
    maxRetriesPerEndpoint?: number;
    baseDelayMs?: number;
  } = {},
): {
  pool: EscrowRpcConnectionPool;
  sleep: jest.Mock;
} {
  const sleep = jest.fn().mockResolvedValue(undefined);
  const pool = new EscrowRpcConnectionPool(
    {
      endpoints,
      requestTimeoutMs: config.requestTimeoutMs ?? 0,
      maxRetriesPerEndpoint: config.maxRetriesPerEndpoint ?? 2,
      baseDelayMs: config.baseDelayMs ?? 250,
      jitterRatio: 0,
    },
    {
      createConnection: (endpoint: string) => connections[endpoint],
      sleep,
      random: () => 0,
      now: () => 0,
    },
  );
  return { pool, sleep };
}

// ===========================================================================
// Â§ Retry classification, backoff, and endpoint resolution
// ===========================================================================

describe("isEscrowRpcRetryableError", () => {
  it("classifies HTTP 429 rate limits as retryable", () => {
    expect(isEscrowRpcRetryableError(httpError(429, "Too Many Requests"))).toBe(
      true,
    );
  });

  it("classifies HTTP 503 service unavailable as retryable", () => {
    expect(
      isEscrowRpcRetryableError(httpError(503, "Service Unavailable")),
    ).toBe(true);
  });

  it("classifies connection timeout errors as retryable", () => {
    expect(
      isEscrowRpcRetryableError(new EscrowRpcTimeoutError(4_000, PRIMARY)),
    ).toBe(true);
    expect(
      isEscrowRpcRetryableError(new Error("network request timed out")),
    ).toBe(true);
  });

  it("classifies deterministic request errors as non-retryable", () => {
    expect(
      isEscrowRpcRetryableError(httpError(400, "Invalid public key")),
    ).toBe(false);
    expect(isEscrowRpcRetryableError(new Error("block hash not found"))).toBe(
      false,
    );
    expect(isEscrowRpcRetryableError(null)).toBe(false);
  });
});

describe("computeEscrowRpcBackoffDelay", () => {
  it("doubles the delay exponentially and caps at the maximum", () => {
    expect(computeEscrowRpcBackoffDelay(0, 250, 8_000, 0, () => 0)).toBe(250);
    expect(computeEscrowRpcBackoffDelay(1, 250, 8_000, 0, () => 0)).toBe(500);
    expect(computeEscrowRpcBackoffDelay(2, 250, 8_000, 0, () => 0)).toBe(1_000);
    expect(computeEscrowRpcBackoffDelay(10, 250, 8_000, 0, () => 0)).toBe(
      8_000,
    );
  });

  it("adds bounded jitter to the exponential delay", () => {
    // jitter = exponential * ratio * random -> 500 + (500 * 0.4 * 0.5) = 600
    expect(computeEscrowRpcBackoffDelay(1, 250, 8_000, 0.4, () => 0.5)).toBe(
      600,
    );
  });
});

describe("resolveEscrowRpcEndpoints", () => {
  it("parses comma and whitespace separated clusters and de-duplicates", () => {
    expect(
      resolveEscrowRpcEndpoints({
        SOLANA_RPC_URLS: `${PRIMARY}, ${SECONDARY}  ${PRIMARY}`,
      }),
    ).toEqual([PRIMARY, SECONDARY]);
  });

  it("prefers the client-visible pool and falls back to legacy single URL", () => {
    expect(
      resolveEscrowRpcEndpoints({
        NEXT_PUBLIC_SOLANA_RPC_URLS: PRIMARY,
        SOLANA_RPC_URL: SECONDARY,
      }),
    ).toEqual([PRIMARY, SECONDARY]);
    expect(resolveEscrowRpcEndpoints({ SOLANA_RPC_URL: TERTIARY })).toEqual([
      TERTIARY,
    ]);
  });

  it("ignores malformed values and defaults to the public devnet endpoint", () => {
    expect(
      resolveEscrowRpcEndpoints({ NEXT_PUBLIC_SOLANA_RPC_URLS: "ws://bad" }),
    ).toEqual([ESCROW_RPC_DEFAULT_ENDPOINT]);
    expect(resolveEscrowRpcEndpoints({})).toEqual([
      ESCROW_RPC_DEFAULT_ENDPOINT,
    ]);
  });
});

// ===========================================================================
// Â§ RPC pool failover
// ===========================================================================

describe("EscrowRpcConnectionPool failover", () => {
  it("executes against the active endpoint and caches connections", async () => {
    const primary = createMockConnection();
    const { pool } = buildPool([PRIMARY, SECONDARY], {
      [PRIMARY]: primary,
      [SECONDARY]: createMockConnection(),
    });

    const result = await pool.execute(async (connection) => {
      return connection.getLatestBlockhash();
    });

    expect(result).toEqual({
      blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
      lastValidBlockHeight: 200_000,
    });
    expect(primary.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(pool.getActiveEndpoint()).toBe(PRIMARY);
  });

  it("rotates to the next endpoint seamlessly on repeated HTTP 429", async () => {
    const primary = createMockConnection({
      getLatestBlockhash: jest
        .fn()
        .mockRejectedValue(httpError(429, "Too Many Requests")),
    });
    const secondary = createMockConnection();
    const { pool, sleep } = buildPool(
      [PRIMARY, SECONDARY],
      { [PRIMARY]: primary, [SECONDARY]: secondary },
      { maxRetriesPerEndpoint: 2, baseDelayMs: 250 },
    );

    const result = await pool.execute((connection) =>
      connection.getLatestBlockhash(),
    );

    // Primary was attempted with exponential backoff, then the pool failed over.
    expect(result.blockhash).toBe(
      "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
    );
    expect(primary.getLatestBlockhash).toHaveBeenCalledTimes(3);
    expect(secondary.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500]);
    expect(pool.getActiveEndpoint()).toBe(SECONDARY);

    // The rate-limited endpoint is marked unhealthy in the health report.
    const primaryHealth = pool
      .getHealthReport()
      .find((entry) => entry.endpoint === PRIMARY);
    expect(primaryHealth?.healthy).toBe(false);
    expect(primaryHealth?.consecutiveFailures).toBe(3);
  });

  it("rotates to the next endpoint on HTTP 503", async () => {
    const primary = createMockConnection({
      getLatestBlockhash: jest
        .fn()
        .mockRejectedValue(httpError(503, "Service Unavailable")),
    });
    const secondary = createMockConnection();
    const { pool } = buildPool([PRIMARY, SECONDARY], {
      [PRIMARY]: primary,
      [SECONDARY]: secondary,
    });

    const result = await pool.execute((connection) =>
      connection.getLatestBlockhash(),
    );

    expect(result.blockhash).toBe(
      "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
    );
    expect(secondary.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(pool.getActiveEndpoint()).toBe(SECONDARY);
  });

  it("rotates to the next endpoint when the connection times out (>4,000ms)", async () => {
    jest.useFakeTimers();
    try {
      const primary = createMockConnection({
        // Stalled request that never settles within the 4s timeout threshold.
        getLatestBlockhash: jest
          .fn()
          .mockImplementation(() => new Promise(() => {})),
      });
      const secondary = createMockConnection();
      const { pool } = buildPool(
        [PRIMARY, SECONDARY],
        { [PRIMARY]: primary, [SECONDARY]: secondary },
        { requestTimeoutMs: 20, maxRetriesPerEndpoint: 0 },
      );

      const pending = pool.execute((connection) =>
        connection.getLatestBlockhash(),
      );
      await jest.advanceTimersByTimeAsync(20);
      const result = await pending;

      expect(result.blockhash).toBe(
        "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
      );
      expect(primary.getLatestBlockhash).toHaveBeenCalledTimes(1);
      expect(secondary.getLatestBlockhash).toHaveBeenCalledTimes(1);
      expect(pool.getActiveEndpoint()).toBe(SECONDARY);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not retry non-retryable errors on the same endpoint", async () => {
    const primary = createMockConnection({
      getLatestBlockhash: jest
        .fn()
        .mockRejectedValue(httpError(400, "Invalid public key input")),
    });
    const secondary = createMockConnection();
    const { pool, sleep } = buildPool([PRIMARY, SECONDARY], {
      [PRIMARY]: primary,
      [SECONDARY]: secondary,
    });

    const result = await pool.execute((connection) =>
      connection.getLatestBlockhash(),
    );

    expect(result.blockhash).toBe(
      "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
    );
    expect(primary.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(pool.getActiveEndpoint()).toBe(SECONDARY);
  });

  it("throws EscrowRpcFailoverError with per-endpoint attempts once the cluster is exhausted", async () => {
    const primary = createMockConnection({
      getLatestBlockhash: jest
        .fn()
        .mockRejectedValue(httpError(429, "HTTP 429 Too Many Requests")),
    });
    const secondary = createMockConnection({
      getLatestBlockhash: jest
        .fn()
        .mockRejectedValue(httpError(503, "HTTP 503 Service Unavailable")),
    });
    const { pool } = buildPool(
      [PRIMARY, SECONDARY],
      { [PRIMARY]: primary, [SECONDARY]: secondary },
      { maxRetriesPerEndpoint: 0 },
    );

    await expect(
      pool.execute((connection) => connection.getLatestBlockhash()),
    ).rejects.toMatchObject({
      name: "EscrowRpcFailoverError",
      attempts: [
        { endpoint: PRIMARY, error: expect.stringContaining("429") },
        { endpoint: SECONDARY, error: expect.stringContaining("503") },
      ],
    });

    await expect(
      pool.execute((connection) => connection.getLatestBlockhash()),
    ).rejects.toBeInstanceOf(EscrowRpcFailoverError);
  });

  it("deprioritizes endpoints that recently failed a health check", async () => {
    const primary = createMockConnection();
    const secondary = createMockConnection();
    const { pool } = buildPool([PRIMARY, SECONDARY], {
      [PRIMARY]: primary,
      [SECONDARY]: secondary,
    });

    // Primary goes unhealthy via an explicit health-check ping failure.
    primary.getLatestBlockhash = jest
      .fn()
      .mockRejectedValueOnce(httpError(503, "Service Unavailable"));
    const health = await pool.checkEndpointHealth(PRIMARY);
    expect(health?.healthy).toBe(false);

    // Execute skips straight to the healthy secondary node.
    await pool.execute((connection) => connection.getLatestBlockhash());
    expect(primary.getLatestBlockhash).toHaveBeenCalledTimes(1); // health ping only
    expect(secondary.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(pool.getActiveEndpoint()).toBe(SECONDARY);
  });
});

// ===========================================================================
// Â§ RPC pool health checks
// ===========================================================================

describe("EscrowRpcConnectionPool health checks", () => {
  it("pings endpoints and records latency for healthy nodes", async () => {
    const primary = createMockConnection();
    const { pool } = buildPool([PRIMARY], { [PRIMARY]: primary });

    const health = await pool.checkEndpointHealth(PRIMARY);

    expect(health).toMatchObject({
      endpoint: PRIMARY,
      healthy: true,
      consecutiveFailures: 0,
      lastError: null,
    });
    expect(health?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health?.lastCheckedAt).not.toBeNull();
    expect(primary.getLatestBlockhash).toHaveBeenCalledTimes(1);
  });

  it("marks endpoints unhealthy when the health-check ping fails", async () => {
    const primary = createMockConnection({
      getLatestBlockhash: jest
        .fn()
        .mockRejectedValue(httpError(429, "HTTP 429 Too Many Requests")),
    });
    const { pool } = buildPool([PRIMARY], { [PRIMARY]: primary });

    const health = await pool.checkEndpointHealth(PRIMARY);

    expect(health).toMatchObject({
      endpoint: PRIMARY,
      healthy: false,
      consecutiveFailures: 1,
    });
    expect(health?.lastError).toContain("429");
  });

  it("restores health after a successful ping and pings every endpoint", async () => {
    const primary = createMockConnection({
      getLatestBlockhash: jest
        .fn()
        .mockRejectedValueOnce(httpError(429, "Too Many Requests")),
    });
    const secondary = createMockConnection();
    const { pool } = buildPool([PRIMARY, SECONDARY], {
      [PRIMARY]: primary,
      [SECONDARY]: secondary,
    });

    const first = await pool.checkAllEndpointsHealth();
    expect(first.find((entry) => entry.endpoint === PRIMARY)?.healthy).toBe(
      false,
    );
    expect(first.find((entry) => entry.endpoint === SECONDARY)?.healthy).toBe(
      true,
    );

    const second = await pool.checkAllEndpointsHealth();
    expect(second.find((entry) => entry.endpoint === PRIMARY)?.healthy).toBe(
      true,
    );
    expect(
      second.find((entry) => entry.endpoint === PRIMARY)?.consecutiveFailures,
    ).toBe(0);
  });
});

// ===========================================================================
// Â§ EscrowClient optimistic confirmation with background polling
// ===========================================================================

describe("EscrowClient optimistic confirmation (#7529)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function buildClient(scriptedStatuses: ScriptedStatuses): {
    client: EscrowClient;
    manager: SolanaPayEscrowManager;
    primary: Connection & MockConnectionParts;
    secondary: Connection & MockConnectionParts;
  } {
    const manager = new SolanaPayEscrowManager();
    const primary = createMockConnection({
      getSignatureStatuses: jest
        .fn()
        .mockRejectedValue(httpError(429, "Too Many Requests")),
    });
    let poll = 0;
    const secondary = createMockConnection({
      getSignatureStatuses: jest.fn().mockImplementation(async () => ({
        value: [
          scriptedStatuses[Math.min(poll++, scriptedStatuses.length - 1)],
        ],
      })),
    });
    const pool = new EscrowRpcConnectionPool(
      {
        endpoints: [PRIMARY, SECONDARY],
        requestTimeoutMs: 0,
        maxRetriesPerEndpoint: 0,
        baseDelayMs: 0,
        jitterRatio: 0,
      },
      {
        createConnection: (endpoint: string) =>
          endpoint === PRIMARY ? primary : secondary,
        sleep: jest.fn().mockResolvedValue(undefined),
        random: () => 0,
        now: () => 0,
      },
    );
    const client = new EscrowClient(
      { pollIntervalMs: 2_000, confirmationTimeoutMs: 60_000 },
      pool,
      manager,
    );
    return { client, manager, primary, secondary };
  }

  it("confirms optimistically upon signature broadcast, then polls to finality", async () => {
    const { client, manager, primary, secondary } = buildClient([
      null,
      makeStatus("confirmed", 500),
      makeStatus("finalized", 532),
    ]);
    const onStateChange = jest.fn();
    const onProvisionallyReserved = jest.fn();
    const onConfirmed = jest.fn();
    const onFinalized = jest.fn();

    const optimistic = await client.reserveSeat({
      seatId: "seat-101",
      venueId: "venue-sf-1",
      signature: "sig_escrow_123",
      payerWallet: "7Y5pAYERwallet1111111111111111111111111111",
      amount: 0.5,
      currency: "SOL",
      callbacks: {
        onStateChange,
        onProvisionallyReserved,
        onConfirmed,
        onFinalized,
      },
    });

    // Optimistic UI confirmation happens immediately upon broadcast.
    expect(optimistic.state).toBe("provisionally_reserved");
    expect(optimistic.paymentStatus).toBe("pending");
    expect(manager.getSeatState("seat-101")?.state).toBe(
      "provisionally_reserved",
    );
    expect(onProvisionallyReserved).toHaveBeenCalledTimes(1);

    // Poll 1: primary endpoint is rate limited -> failover to secondary (pending).
    await jest.advanceTimersByTimeAsync(2_000);
    expect(primary.getSignatureStatuses).toHaveBeenCalledTimes(1);
    expect(secondary.getSignatureStatuses).toHaveBeenCalledTimes(1);
    expect(client.getActiveEndpoint()).toBe(SECONDARY);
    expect(manager.getSeatState("seat-101")?.state).toBe(
      "provisionally_reserved",
    );

    // Poll 2: transaction transitions optimistic -> confirmed.
    await jest.advanceTimersByTimeAsync(2_000);
    const confirmed = manager.getSeatState("seat-101");
    expect(confirmed?.state).toBe("confirmed");
    expect(confirmed?.paymentStatus).toBe("confirmed");
    expect(confirmed?.slot).toBe(500);
    expect(onConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ state: "confirmed", slot: 500 }),
    );

    // Poll 3: confirmed -> finalized.
    await jest.advanceTimersByTimeAsync(2_000);
    const finalized = manager.getSeatState("seat-101");
    expect(finalized?.state).toBe("finalized");
    expect(finalized?.paymentStatus).toBe("finalized");
    expect(finalized?.slot).toBe(532);
    expect(onFinalized).toHaveBeenCalledWith(
      expect.objectContaining({ state: "finalized", slot: 532 }),
    );

    const states = onStateChange.mock.calls.map(([state]) => state.state);
    expect(states).toEqual([
      "provisionally_reserved",
      "confirmed",
      "finalized",
    ]);
  });

  it("rolls back the optimistic state gracefully when the transaction fails on-chain", async () => {
    const { client, manager } = buildClient([
      {
        ...makeStatus("confirmed"),
        err: { InstructionError: [0, "Custom(1)"] },
      },
    ]);
    const onError = jest.fn();
    const onRollback = jest.fn();

    await client.reserveSeat({
      seatId: "seat-failed",
      venueId: "venue-1",
      signature: "sig_failed",
      payerWallet: "7Y5pAYERwallet1111111111111111111111111111",
      amount: 1,
      callbacks: { onError, onRollback },
    });

    await jest.advanceTimersByTimeAsync(2_000);

    const state = manager.getSeatState("seat-failed");
    expect(state?.state).toBe("available");
    expect(state?.paymentStatus).toBe("failed");
    expect(state?.error).toContain("Transaction failed on-chain");
    expect(state?.error).toContain("Custom(1)");
    expect(onRollback).toHaveBeenCalledWith(
      expect.stringContaining("Transaction failed on-chain"),
      expect.objectContaining({ state: "available" }),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ state: "available", paymentStatus: "failed" }),
    );
  });

  it("rolls back the optimistic state when the transaction drops from the mempool", async () => {
    const { client, manager } = buildClient([null]);
    const onRollback = jest.fn();

    await client.reserveSeat({
      seatId: "seat-timeout",
      venueId: "venue-1",
      signature: "sig_timeout",
      payerWallet: "7Y5pAYERwallet1111111111111111111111111111",
      amount: 1,
      callbacks: { onRollback },
    });

    await jest.advanceTimersByTimeAsync(59_000);
    expect(manager.getSeatState("seat-timeout")?.state).toBe(
      "provisionally_reserved",
    );

    await jest.advanceTimersByTimeAsync(1_500);

    const state = manager.getSeatState("seat-timeout");
    expect(state?.state).toBe("available");
    expect(state?.paymentStatus).toBe("timeout");
    expect(state?.error).toContain("timed out after 60 seconds");
    expect(state?.error).toContain("dropped from mempool");
    expect(onRollback).toHaveBeenCalledWith(
      expect.stringContaining("dropped from mempool"),
      expect.objectContaining({ state: "available" }),
    );
  });

  it("keeps polling through transient RPC failures until the transaction confirms", async () => {
    const { client, manager } = buildClient([
      null,
      makeStatus("confirmed", 700),
      makeStatus("finalized", 710),
    ]);
    const pool = client.getRpcPool();

    await client.reserveSeat({
      seatId: "seat-resilient",
      venueId: "venue-1",
      signature: "sig_resilient",
      payerWallet: "7Y5pAYERwallet1111111111111111111111111111",
      amount: 1,
    });

    // Force the pool to throw (all endpoints exhausted) for one poll cycle.
    const failingPoolExecute = jest
      .spyOn(pool, "execute")
      .mockRejectedValueOnce(
        new EscrowRpcFailoverError([{ endpoint: PRIMARY, error: "429" }]),
      );

    await jest.advanceTimersByTimeAsync(2_000);
    expect(manager.getSeatState("seat-resilient")?.state).toBe(
      "provisionally_reserved",
    );

    failingPoolExecute.mockRestore();

    // Poll 2: failover to the healthy endpoint (still pending).
    await jest.advanceTimersByTimeAsync(2_000);
    expect(manager.getSeatState("seat-resilient")?.state).toBe(
      "provisionally_reserved",
    );

    // Poll 3: confirmed.
    await jest.advanceTimersByTimeAsync(2_000);
    expect(manager.getSeatState("seat-resilient")?.state).toBe("confirmed");

    // Poll 4: finalized.
    await jest.advanceTimersByTimeAsync(2_000);
    expect(manager.getSeatState("seat-resilient")?.state).toBe("finalized");
  });

  it("routes signature status lookups through the failover pool", async () => {
    const { client, primary, secondary } = buildClient([
      makeStatus("confirmed", 42),
    ]);

    const status = await client.getSignatureStatus("sig_lookup");

    expect(primary.getSignatureStatuses).toHaveBeenCalledTimes(1);
    expect(secondary.getSignatureStatuses).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({
      slot: 42,
      confirmationStatus: "confirmed",
      err: null,
    });
    expect(client.getActiveEndpoint()).toBe(SECONDARY);
  });
});

// ===========================================================================
// Â§ WebSocket subscription failure falls back to background polling
// ===========================================================================

describe("SolanaPayEscrowManager WebSocket fallback to polling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("falls back to background polling when WebSocket subscriptions cannot be registered", async () => {
    const manager = new SolanaPayEscrowManager();
    const statuses: ScriptedStatuses = [
      makeStatus("confirmed", 424),
      makeStatus("finalized", 444),
    ];
    let poll = 0;
    const connection = createMockConnection({
      onSignatureWithOptions: jest.fn(() => {
        throw new Error("RPC node is unhealthy: subscription refused");
      }),
      getSignatureStatuses: jest.fn().mockImplementation(async () => ({
        value: [statuses[Math.min(poll++, statuses.length - 1)]],
      })),
    });

    await manager.reserveSeatOptimistically({
      connection: connection as Connection,
      seatId: "seat-ws-fallback",
      venueId: "venue-1",
      signature: "sig_fallback",
      payerWallet: "7Y5pAYERwallet1111111111111111111111111111",
      amount: 1,
      pollIntervalMs: 1_000,
      timeoutMs: 30_000,
    });

    expect(manager.getSeatState("seat-ws-fallback")?.state).toBe(
      "provisionally_reserved",
    );

    await jest.advanceTimersByTimeAsync(1_000);
    expect(manager.getSeatState("seat-ws-fallback")?.state).toBe("confirmed");

    await jest.advanceTimersByTimeAsync(1_000);
    expect(manager.getSeatState("seat-ws-fallback")?.state).toBe("finalized");
    expect(connection.getSignatureStatuses).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Â§ Shared singletons
// ===========================================================================

describe("escrow client singletons", () => {
  it("returns stable shared instances and resets cleanly", () => {
    const pool = getEscrowRpcPool();
    expect(getEscrowRpcPool()).toBe(pool);
    expect(pool.getActiveEndpoint()).not.toBeNull();

    const client = getEscrowClient();
    expect(getEscrowClient()).toBe(client);
    expect(client.getRpcPool()).toBe(pool);

    resetEscrowClient();
    resetEscrowRpcPool();
    expect(getEscrowRpcPool()).not.toBe(pool);
    expect(getEscrowClient()).not.toBe(client);
  });
});

// ===========================================================================
// Â§ Multi-RPC 2-of-3 quorum simulation, PENDING_CONSENSUS & leader-drop rollback (#7682)
// ===========================================================================

describe("simulateEscrowTransaction 2-of-3 multi-RPC quorum (#7682)", () => {
  it("achieves 2-of-3 quorum when one RPC fails transiently, returns PENDING_CONSENSUS immediately, and finalizes", async () => {
    const telemetryLog: QuorumTelemetryRecord[] = [];
    const onRollback = jest.fn();
    let pollRound = 0;

    const makeNode = (id: string, failSim = false) =>
      ({
        rpcEndpoint: id,
        simulateTransaction: jest.fn(async () => {
          if (failSim) {
            throw httpError(429, "Too Many Requests");
          }
          return {
            context: { slot: 800_100 },
            value: {
              err: null,
              logs: ["Program log: Escrow deposited"],
              slot: 800_100,
            },
          };
        }),
        getSignatureStatuses: jest.fn(async () => {
          if (failSim) {
            throw httpError(503, "Node desynchronized");
          }
          pollRound++;
          const finalized = pollRound > 2;
          return {
            value: [
              makeStatus(
                finalized ? "finalized" : "confirmed",
                finalized ? 800_120 : 800_105,
              ),
            ],
          };
        }),
      }) as unknown as Connection;

    const c1 = makeNode(PRIMARY, true);
    const c2 = makeNode(SECONDARY, false);
    const c3 = makeNode(TERTIARY, false);

    const result = await simulateEscrowTransaction([c1, c2, c3], {} as any, {
      endpoints: [PRIMARY, SECONDARY, TERTIARY],
      signature: "sig_quorum_ok_7682",
      quorumSize: 2,
      pollIntervalMs: 5,
      maxPollAttempts: 5,
      onRollback,
      onTelemetry: (rec) => telemetryLog.push(rec),
    });

    expect(result.success).toBe(true);
    expect(result.state).toBe("PENDING_CONSENSUS");
    expect(result.quorumReached).toBe(true);
    expect(result.optimisticSlot).toBe(800_100);

    const finalized = await result.commitmentPromise;
    expect(finalized.state).toBe("FINALIZED");
    expect(finalized.rolledBack).toBe(false);
    expect(finalized.finalizedSlot).toBe(800_120);
    expect(onRollback).not.toHaveBeenCalled();
    expect(telemetryLog.length).toBeGreaterThanOrEqual(2);
    expect(telemetryLog[0].achievedConfirmations).toBe(2);
  });

  it("rolls back automatically when signature is dropped from the leader queue before finalized commitment", async () => {
    const onRollback = jest.fn();
    let pollCalls = 0;

    const makeNode = (id: string) =>
      ({
        rpcEndpoint: id,
        simulateTransaction: jest.fn(async () => ({
          context: { slot: 900_000 },
          value: { err: null, logs: [], slot: 900_000 },
        })),
        getSignatureStatuses: jest.fn(async () => {
          pollCalls++;
          if (pollCalls <= 3) {
            return { value: [makeStatus("processed", 900_001)] };
          }
          return { value: [null] };
        }),
      }) as unknown as Connection;

    const result = await simulateEscrowTransaction(
      [makeNode(PRIMARY), makeNode(SECONDARY), makeNode(TERTIARY)],

      {} as any,
      {
        endpoints: [PRIMARY, SECONDARY, TERTIARY],
        signature: "sig_dropped_7682",
        quorumSize: 2,
        pollIntervalMs: 5,
        maxPollAttempts: 5,
        onRollback,
      },
    );

    expect(result.state).toBe("PENDING_CONSENSUS");

    const outcome = await result.commitmentPromise;
    expect(outcome.state).toBe("ROLLED_BACK");
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.rollbackReason).toMatch(/dropped from leader queue/i);
    expect(onRollback).toHaveBeenCalledWith(
      "sig_dropped_7682",
      expect.stringMatching(/dropped from leader queue/i),
    );
  });
});
