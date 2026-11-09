import {
  DEFAULT_MAX_RELAY_FEE_LAMPORTS,
  validateRelayFeeLamports,
  getSolanaExplorerUrl,
  getSolscanUrl,
} from "@/lib/payments/solanaPay";

describe("validateRelayFeeLamports", () => {
  it("accepts fees within the configured ceiling", () => {
    expect(validateRelayFeeLamports(5_000, 10_000)).toBe(5_000);
  });

  it("uses a conservative default fee ceiling", () => {
    expect(() =>
      validateRelayFeeLamports(DEFAULT_MAX_RELAY_FEE_LAMPORTS + 1),
    ).toThrow("Transaction fee exceeds the relayer limit");
  });

  it.each([-5000, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid or non-positive fee value %p",
    (fee) => {
      expect(() => validateRelayFeeLamports(fee)).toThrow(
        "Relay fee must be a positive integer greater than zero",
      );
    },
  );

  it.each([-1000, 0, 1.5])(
    "rejects an invalid configured ceiling %p",
    (ceiling) => {
      expect(() => validateRelayFeeLamports(1, ceiling)).toThrow(
        "Maximum relay fee must be a positive integer greater than zero",
      );
    },
  );
});

describe("Solana Explorer URL helpers", () => {
  it("constructs mainnet Solana Explorer URL", () => {
    const url = getSolanaExplorerUrl("5K2xMockTxSignature123");
    expect(url).toBe("https://explorer.solana.com/tx/5K2xMockTxSignature123");
  });

  it("constructs cluster-specific Solana Explorer URL", () => {
    const url = getSolanaExplorerUrl("5K2xMockTxSignature123", "devnet");
    expect(url).toBe("https://explorer.solana.com/tx/5K2xMockTxSignature123?cluster=devnet");
  });

  it("constructs Solscan URL", () => {
    const url = getSolscanUrl("5K2xMockTxSignature123");
    expect(url).toBe("https://solscan.io/tx/5K2xMockTxSignature123");
  });
});

