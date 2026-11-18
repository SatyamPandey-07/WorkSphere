const createdEndpoints: string[] = [];

jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  return {
    ...actual,
    Connection: jest.fn().mockImplementation((endpoint: string) => {
      createdEndpoints.push(endpoint);
      return {
        rpcEndpoint: endpoint,
        simulateTransaction: jest.fn().mockResolvedValue({
          context: { slot: 100 },
          value: { err: null, logs: [`Program log: ${endpoint}`] },
        }),
        getSignatureStatuses: jest.fn().mockResolvedValue({ value: [null] }),
      };
    }),
  };
});

import {
  EscrowRpcConnectionPool,
  resetEscrowRpcPool,
  simulateEscrowTransaction,
} from "@/lib/solana/escrowClient";

const PRIMARY = "https://rpc-primary.example.com";
const BACKUP_1 = "https://rpc-backup-1.example.com";
const BACKUP_2 = "https://rpc-backup-2.example.com";

describe("quorum simulation with backup RPC endpoints", () => {
  beforeEach(() => {
    createdEndpoints.length = 0;
    resetEscrowRpcPool();
    jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("simulates on every configured endpoint and reaches quorum", async () => {
    const primary = {
      rpcEndpoint: PRIMARY,
      simulateTransaction: jest.fn().mockResolvedValue({
        context: { slot: 100 },
        value: { err: null, logs: ["Program log: primary"] },
      }),
      getSignatureStatuses: jest.fn().mockResolvedValue({ value: [null] }),
    };

    const result = await simulateEscrowTransaction(
      primary as never,
      {} as never,
      {
        endpoints: [PRIMARY, BACKUP_1, BACKUP_2],
        maxPollAttempts: 0,
      },
    );

    expect(result.success).toBe(true);
    expect(result.quorumReached).toBe(true);
    expect(result.telemetry.totalNodes).toBe(3);
    expect(result.telemetry.nodes.map((node) => node.endpoint).sort()).toEqual(
      [BACKUP_1, BACKUP_2, PRIMARY].sort(),
    );
    expect(createdEndpoints.sort()).toEqual([BACKUP_1, BACKUP_2].sort());
  });
});

describe("EscrowRpcConnectionPool.getConnectionForEndpoint", () => {
  const createConnection = jest.fn(
    async (endpoint: string) => ({ endpoint }) as never,
  );

  beforeEach(() => createConnection.mockClear());

  it("returns a cached connection for an endpoint of the pool", async () => {
    const pool = new EscrowRpcConnectionPool(
      { endpoints: [PRIMARY, BACKUP_1] },
      { createConnection },
    );

    const first = await pool.getConnectionForEndpoint(BACKUP_1);
    const second = await pool.getConnectionForEndpoint(BACKUP_1);

    expect(first).toEqual({ endpoint: BACKUP_1 });
    expect(second).toBe(first);
    expect(createConnection).toHaveBeenCalledTimes(1);
  });

  it("rejects an endpoint that is not part of the pool", async () => {
    const pool = new EscrowRpcConnectionPool(
      { endpoints: [PRIMARY] },
      { createConnection },
    );

    await expect(
      pool.getConnectionForEndpoint("https://unknown.example.com"),
    ).rejects.toThrow(/not part of this pool/);
    expect(createConnection).not.toHaveBeenCalled();
  });
});
