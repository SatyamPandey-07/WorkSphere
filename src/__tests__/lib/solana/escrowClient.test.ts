import { Connection, Transaction } from "@solana/web3.js";
import {
  simulateEscrowTransaction,
  DEFAULT_SIMULATION_TIMEOUT_MS,
} from "@/lib/solana/escrowClient";

describe("simulateEscrowTransaction", () => {
  const dummyTx = new Transaction();
  const noOpSleep = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SOLANA_RPC_FALLBACK_URL;
  });

  it("recovers after transient RPC timeouts and succeeds on retry", async () => {
    const mockSimulate = jest
      .fn()
      .mockRejectedValueOnce(new Error("FetchError: network timeout"))
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValueOnce({
        value: {
          err: null,
          logs: ["Program log: Escrow OK"],
          unitsConsumed: 1200,
        },
      });

    const factory = jest.fn(
      () => ({ simulateTransaction: mockSimulate }) as unknown as Connection,
    );

    const result = await simulateEscrowTransaction(dummyTx, {
      primaryRpcUrl: "https://primary.devnet.solana.com",
      connectionFactory: factory,
      sleepFn: noOpSleep,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.attempts).toBe(3);
      expect(result.rpcEndpoint).toBe("https://primary.devnet.solana.com");
    }
    expect(noOpSleep).toHaveBeenCalledTimes(2);
  });

  it("falls back to secondary RPC endpoint when primary exhausts retries", async () => {
    const primarySimulate = jest
      .fn()
      .mockRejectedValue(new Error("503 Service Unavailable"));
    const fallbackSimulate = jest.fn().mockResolvedValueOnce({
      value: {
        err: null,
        logs: ["Program log: Fallback OK"],
        unitsConsumed: 950,
      },
    });

    const factory = jest.fn((endpoint: string) => {
      if (endpoint.includes("fallback")) {
        return {
          simulateTransaction: fallbackSimulate,
        } as unknown as Connection;
      }
      return { simulateTransaction: primarySimulate } as unknown as Connection;
    });

    const result = await simulateEscrowTransaction(dummyTx, {
      primaryRpcUrl: "https://primary.devnet.solana.com",
      fallbackRpcUrl: "https://fallback.devnet.solana.com",
      connectionFactory: factory,
      sleepFn: noOpSleep,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rpcEndpoint).toBe("https://fallback.devnet.solana.com");
      expect(result.attempts).toBe(5); // 4 primary attempts + 1 fallback attempt
    }
  });

  it("enforces timeout via Promise.race and returns structured retryable timeout payload", async () => {
    const hangingSimulate = jest.fn(
      () => new Promise(() => {}), // Never resolves
    );

    const factory = jest.fn(
      () => ({ simulateTransaction: hangingSimulate }) as unknown as Connection,
    );

    const result = await simulateEscrowTransaction(dummyTx, {
      timeoutMs: 25,
      maxRetries: 2,
      primaryRpcUrl: "https://primary.devnet.solana.com",
      connectionFactory: factory,
      sleepFn: noOpSleep,
    });

    expect(DEFAULT_SIMULATION_TIMEOUT_MS).toBe(8000);
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "RPC_SIMULATION_TIMEOUT",
        retryable: true,
        attempts: 3,
      }),
    );
  });
});
