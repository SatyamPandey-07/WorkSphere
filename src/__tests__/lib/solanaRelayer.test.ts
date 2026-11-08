import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  calculatePriorityFeePercentile,
  clampPriorityFee,
  getPriorityFeeBounds,
  getDynamicPriorityFee,
  injectPriorityFeeInstruction,
  relayGaslessUsdcTransaction,
  relayerMutex,
  RelayerMutex,
  getLatestBlockhashWithCache,
  clearBlockhashCache,
  BLOCKHASH_CACHE_TTL_MS,
  DEFAULT_PRIORITY_FEE_PERCENTILE,
  DEFAULT_MIN_PRIORITY_FEE_MICRO_LAMPORTS,
  DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS,
} from "@/lib/payments/solanaRelayer";

describe("solanaRelayer priority fee dynamic adjustment (#5774)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("calculatePriorityFeePercentile", () => {
    it("returns 0 for empty or invalid fee arrays", () => {
      expect(calculatePriorityFeePercentile([])).toBe(0);
      expect(calculatePriorityFeePercentile([NaN, -100, -1] as any)).toBe(0);
    });

    it("calculates the default 75th percentile fee from numeric array", () => {
      // 4 items: sorted = [100, 200, 300, 400]
      // index: ceil(0.75 * 4) - 1 = 3 - 1 = 2 -> 300
      const fees = [400, 100, 300, 200];
      expect(calculatePriorityFeePercentile(fees)).toBe(300);
    });

    it("calculates 75th percentile from RPC getRecentPrioritizationFees object format", () => {
      const rpcFees = [
        { slot: 1, prioritizationFee: 500 },
        { slot: 2, prioritizationFee: 1500 },
        { slot: 3, prioritizationFee: 2500 },
        { slot: 4, prioritizationFee: 3500 },
      ];
      expect(calculatePriorityFeePercentile(rpcFees, 75)).toBe(2500);
    });

    it("supports custom percentiles such as median (50th) and 90th percentile", () => {
      const fees = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      // 50th percentile (median): ceil(0.5 * 10) - 1 = 5 - 1 = 4 -> 50
      expect(calculatePriorityFeePercentile(fees, 50)).toBe(50);
      // 90th percentile: ceil(0.9 * 10) - 1 = 9 - 1 = 8 -> 90
      expect(calculatePriorityFeePercentile(fees, 90)).toBe(90);
    });

    it("filters out invalid values like NaN and negative numbers", () => {
      const mixed = [100, NaN, -50, 500, 1000];
      // valid: [100, 500, 1000]
      // 75th percentile: ceil(0.75 * 3) - 1 = 3 - 1 = 2 -> 1000
      expect(calculatePriorityFeePercentile(mixed)).toBe(1000);
    });
  });

  describe("clampPriorityFee", () => {
    it("clamps fee below min bound to configured min bound", () => {
      expect(clampPriorityFee(100, 1_000, 500_000)).toBe(1_000);
      expect(clampPriorityFee(0, 1_000, 500_000)).toBe(1_000);
    });

    it("clamps fee above max bound to configured max bound", () => {
      expect(clampPriorityFee(2_000_000, 1_000, 1_000_000)).toBe(1_000_000);
    });

    it("preserves fee within bounds", () => {
      expect(clampPriorityFee(25_000, 1_000, 1_000_000)).toBe(25_000);
    });
  });

  describe("getPriorityFeeBounds", () => {
    it("returns default bounds when environment variables are not set", () => {
      delete process.env.SOLANA_MIN_PRIORITY_FEE_MICRO_LAMPORTS;
      delete process.env.SOLANA_MAX_PRIORITY_FEE_MICRO_LAMPORTS;
      delete process.env.SOLANA_PRIORITY_FEE_PERCENTILE;

      const bounds = getPriorityFeeBounds();
      expect(bounds.minFee).toBe(DEFAULT_MIN_PRIORITY_FEE_MICRO_LAMPORTS);
      expect(bounds.maxFee).toBe(DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS);
      expect(bounds.percentile).toBe(DEFAULT_PRIORITY_FEE_PERCENTILE);
    });

    it("reads custom bounds from environment variables", () => {
      process.env.SOLANA_MIN_PRIORITY_FEE_MICRO_LAMPORTS = "5000";
      process.env.SOLANA_MAX_PRIORITY_FEE_MICRO_LAMPORTS = "2000000";
      process.env.SOLANA_PRIORITY_FEE_PERCENTILE = "80";

      const bounds = getPriorityFeeBounds();
      expect(bounds.minFee).toBe(5000);
      expect(bounds.maxFee).toBe(2000000);
      expect(bounds.percentile).toBe(80);
    });
  });

  describe("injectPriorityFeeInstruction", () => {
    it("appends ComputeBudgetProgram.setComputeUnitPrice instruction to transaction", () => {
      const tx = new Transaction();
      injectPriorityFeeInstruction(tx, 50_000);

      expect(tx.instructions.length).toBe(1);
      const ix = tx.instructions[0];
      expect(ix.programId.equals(ComputeBudgetProgram.programId)).toBe(true);
      // Discriminator 3 corresponds to setComputeUnitPrice
      expect(ix.data[0]).toBe(3);
    });

    it("updates existing setComputeUnitPrice instruction without adding duplicate", () => {
      const tx = new Transaction();
      injectPriorityFeeInstruction(tx, 10_000);
      expect(tx.instructions.length).toBe(1);

      // Re-inject with updated fee
      injectPriorityFeeInstruction(tx, 75_000);
      expect(tx.instructions.length).toBe(1);
      expect(tx.instructions[0].programId.equals(ComputeBudgetProgram.programId)).toBe(true);
    });
  });

  describe("getDynamicPriorityFee", () => {
    it("queries getRecentPrioritizationFees and applies 75th percentile and bounds", async () => {
      const mockRecentFees = [
        { slot: 10, prioritizationFee: 2_000 },
        { slot: 11, prioritizationFee: 8_000 },
        { slot: 12, prioritizationFee: 15_000 },
        { slot: 13, prioritizationFee: 30_000 },
      ];

      const mockConnection = {
        getRecentPrioritizationFees: jest.fn().mockResolvedValue(mockRecentFees),
      } as unknown as Connection;

      const writableAccount = new PublicKey("11111111111111111111111111111111");
      const fee = await getDynamicPriorityFee(mockConnection, [writableAccount], {
        percentile: 75,
        minFee: 1_000,
        maxFee: 500_000,
      });

      expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledWith([writableAccount]);
      expect(fee).toBe(15_000);
    });

    it("falls back to minimum fee bound when RPC query fails", async () => {
      const mockConnection = {
        getRecentPrioritizationFees: jest.fn().mockRejectedValue(new Error("RPC Timeout")),
      } as unknown as Connection;

      const fee = await getDynamicPriorityFee(mockConnection, undefined, {
        minFee: 2_500,
      });

      expect(fee).toBe(2_500);
    });
  });

  describe("relayGaslessUsdcTransaction dynamic tip injection", () => {
    it("dynamically queries priority fees and injects compute budget instruction before relaying", async () => {
      const relayerKeypair = Keypair.generate();
      const userKeypair = Keypair.generate();
      const relayerKeypairJson = JSON.stringify(Array.from(relayerKeypair.secretKey));

      process.env.SOLANA_RELAYER_PRIVATE_KEY = relayerKeypairJson;
      process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";

      // Mock Connection methods
      const mockGetRecentPrioritizationFees = jest.fn().mockResolvedValue([
        { slot: 1, prioritizationFee: 10_000 },
        { slot: 2, prioritizationFee: 20_000 },
      ]);
      const mockGetFeeForMessage = jest.fn().mockResolvedValue({ value: 5_000 });
      const mockSendRawTransaction = jest.fn().mockResolvedValue("mockTxSignature123");

      jest.spyOn(Connection.prototype, "getRecentPrioritizationFees").mockImplementation(mockGetRecentPrioritizationFees);
      jest.spyOn(Connection.prototype, "getFeeForMessage").mockImplementation(mockGetFeeForMessage);
      jest.spyOn(Connection.prototype, "sendRawTransaction").mockImplementation(mockSendRawTransaction);

      // Create a valid transaction signed by user with relayer as fee payer
      const tx = new Transaction();
      tx.feePayer = relayerKeypair.publicKey;
      tx.recentBlockhash = "GHtXQBsoZHVnNFa9YevAzFr1KkWghBxTVmkLqwJaNwLX";
      tx.add(
        SystemProgram.transfer({
          fromPubkey: userKeypair.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1_000,
        }),
      );
      tx.partialSign(userKeypair);

      const serializedBase64 = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString("base64");

      const result = await relayGaslessUsdcTransaction(serializedBase64);

      expect(result.signature).toBe("mockTxSignature123");
      expect(result.feeLamports).toBe(5_000);
      expect(result.priorityFeeMicroLamports).toBeGreaterThanOrEqual(1_000);
      expect(mockGetRecentPrioritizationFees).toHaveBeenCalled();
      expect(mockSendRawTransaction).toHaveBeenCalled();
    });
  });

  describe("RelayerMutex FIFO lock & blockhash cache (#5741)", () => {
    it("ensures strict FIFO ordering and mutual exclusion", async () => {
      const mutex = new RelayerMutex();
      const executionOrder: number[] = [];

      const runTask = async (id: number, delayMs: number) => {
        const release = await mutex.acquire();
        executionOrder.push(id);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        release();
      };

      await Promise.all([
        runTask(1, 30),
        runTask(2, 20),
        runTask(3, 10),
      ]);

      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it("caches latest blockhash within the 30-second TTL buffer", async () => {
      clearBlockhashCache();

      const mockGetLatestBlockhash = jest.fn().mockResolvedValue({
        blockhash: "Blockhash1111111111111111111111111111111111",
        lastValidBlockHeight: 12345,
      });

      const mockConnection = {
        getLatestBlockhash: mockGetLatestBlockhash,
      } as unknown as Connection;

      const bh1 = await getLatestBlockhashWithCache(mockConnection, false, 30_000);
      const bh2 = await getLatestBlockhashWithCache(mockConnection, false, 30_000);

      expect(bh1).toBe("Blockhash1111111111111111111111111111111111");
      expect(bh2).toBe(bh1);
      expect(mockGetLatestBlockhash).toHaveBeenCalledTimes(1);

      // Force refresh bypasses cache
      mockGetLatestBlockhash.mockResolvedValueOnce({
        blockhash: "Blockhash2222222222222222222222222222222222",
        lastValidBlockHeight: 12346,
      });
      const bh3 = await getLatestBlockhashWithCache(mockConnection, true);
      expect(bh3).toBe("Blockhash2222222222222222222222222222222222");
      expect(mockGetLatestBlockhash).toHaveBeenCalledTimes(2);
    });

    it("simulates 10 concurrent relay requests without transaction collisions", async () => {
      const relayerKeypair = Keypair.generate();
      process.env.SOLANA_RELAYER_PRIVATE_KEY = JSON.stringify(Array.from(relayerKeypair.secretKey));
      process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";

      let activeSigners = 0;
      let maxConcurrentSigners = 0;

      const mockGetRecentPrioritizationFees = jest.fn().mockResolvedValue([
        { slot: 1, prioritizationFee: 5_000 },
      ]);
      const mockGetFeeForMessage = jest.fn().mockResolvedValue({ value: 5_000 });
      const mockGetLatestBlockhash = jest.fn().mockResolvedValue({
        blockhash: "CachedBlockhash3333333333333333333333333333",
        lastValidBlockHeight: 99999,
      });

      const mockSendRawTransaction = jest.fn().mockImplementation(async () => {
        activeSigners++;
        if (activeSigners > maxConcurrentSigners) {
          maxConcurrentSigners = activeSigners;
        }
        // Simulate validator processing latency
        await new Promise((resolve) => setTimeout(resolve, 15));
        activeSigners--;
        return `txSig_${Math.random().toString(36).substring(7)}`;
      });

      jest.spyOn(Connection.prototype, "getRecentPrioritizationFees").mockImplementation(mockGetRecentPrioritizationFees);
      jest.spyOn(Connection.prototype, "getFeeForMessage").mockImplementation(mockGetFeeForMessage);
      jest.spyOn(Connection.prototype, "getLatestBlockhash").mockImplementation(mockGetLatestBlockhash);
      jest.spyOn(Connection.prototype, "sendRawTransaction").mockImplementation(mockSendRawTransaction);

      // Prepare 10 concurrent transactions signed by different users
      const requests = Array.from({ length: 10 }).map((_, index) => {
        const userKeypair = Keypair.generate();
        const tx = new Transaction();
        tx.feePayer = relayerKeypair.publicKey;
        tx.recentBlockhash = "CachedBlockhash3333333333333333333333333333";
        tx.add(
          SystemProgram.transfer({
            fromPubkey: userKeypair.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1_000 + index,
          }),
        );
        tx.partialSign(userKeypair);

        const base64 = tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }).toString("base64");

        return relayGaslessUsdcTransaction(base64);
      });

      const results = await Promise.all(requests);

      expect(results.length).toBe(10);
      expect(mockSendRawTransaction).toHaveBeenCalledTimes(10);
      // Mutex guarantees single-flight serialization: max active signers is 1
      expect(maxConcurrentSigners).toBe(1);
      expect(activeSigners).toBe(0);
    });
  });
});
