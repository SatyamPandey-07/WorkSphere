/** @jest-environment node */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  Transaction,
} from "@solana/web3.js";
import {
  buildRefundTransaction,
  buildReleaseTransaction,
  buildSolDepositTransaction,
  buildUsdcDepositTransaction,
  DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS,
  resolveCappedPriorityFee,
  SolanaEscrowClient,
} from "@/lib/solana/escrowClient";
import { resetPriorityFeeEstimator } from "@/lib/solana/priorityFeeEstimator";
import type { EscrowRecord } from "@/lib/solana/escrowStateMachine";

function readComputeUnitPriceMicroLamports(tx: Transaction): number | null {
  const ix = tx.instructions.find(
    (entry) =>
      entry.programId.equals(ComputeBudgetProgram.programId) &&
      entry.data.length >= 9 &&
      entry.data[0] === 3,
  );
  if (!ix) return null;
  return Number(ix.data.readBigUInt64LE(1));
}

describe("Escrow priority-fee percentile cap (#10542)", () => {
  beforeEach(() => {
    resetPriorityFeeEstimator();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    resetPriorityFeeEstimator();
    jest.restoreAllMocks();
  });

  describe("resolveCappedPriorityFee", () => {
    it("caps estimated fee at custom maxPriorityFeeMicroLamports and records diagnostics", () => {
      const diagnostics = resolveCappedPriorityFee({
        estimatedMicroLamports: 120_000,
        maxPriorityFeeMicroLamports: 25_000,
      });

      expect(diagnostics).toEqual({
        estimatedMicroLamports: 120_000,
        maxPriorityFeeMicroLamports: 25_000,
        appliedMicroLamports: 25_000,
        wasCapped: true,
      });
    });

    it("preserves uncapped fee when below ceiling", () => {
      const diagnostics = resolveCappedPriorityFee({
        estimatedMicroLamports: 12_500,
        maxPriorityFeeMicroLamports: 50_000,
      });

      expect(diagnostics).toEqual({
        estimatedMicroLamports: 12_500,
        maxPriorityFeeMicroLamports: 50_000,
        appliedMicroLamports: 12_500,
        wasCapped: false,
      });
    });

    it("falls back to DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS when ceiling is omitted", () => {
      const diagnostics = resolveCappedPriorityFee({
        explicitMicroLamports: 2_500_000,
      });

      expect(diagnostics).toEqual({
        estimatedMicroLamports: 2_500_000,
        maxPriorityFeeMicroLamports: DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS,
        appliedMicroLamports: DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS,
        wasCapped: true,
      });
    });
  });

  describe("deposit transaction builders", () => {
    it("caps dynamically estimated priority fee in buildSolDepositTransaction and records diagnostics", async () => {
      const payer = Keypair.generate().publicKey.toBase58();
      jest
        .spyOn(Connection.prototype, "getBalance")
        .mockResolvedValue(5_000_000_000);
      jest
        .spyOn(Connection.prototype, "getLatestBlockhash")
        .mockResolvedValue({
          blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
          lastValidBlockHeight: 200_000,
        });
      jest
        .spyOn(Connection.prototype, "getRecentPrioritizationFees")
        .mockResolvedValue([
          { slot: 1, prioritizationFee: 40_000 },
          { slot: 2, prioritizationFee: 80_000 },
          { slot: 3, prioritizationFee: 100_000 },
          { slot: 4, prioritizationFee: 150_000 },
        ]);

      const result = await buildSolDepositTransaction({
        payerWallet: payer,
        bookingId: "booking-cap-sol-1",
        amount: 0.5,
        currency: "SOL",
        rpcUrl: "https://api.devnet.solana.com",
        maxPriorityFeeMicroLamports: 30_000,
      });

      expect(result.priorityFeeDiagnostics).toEqual({
        estimatedMicroLamports: 100_000,
        maxPriorityFeeMicroLamports: 30_000,
        appliedMicroLamports: 30_000,
        wasCapped: true,
      });

      const tx = Transaction.from(
        Buffer.from(result.serializedTransaction, "base64"),
      );
      expect(readComputeUnitPriceMicroLamports(tx)).toBe(30_000);
    });

    it("records uncapped diagnostics in buildUsdcDepositTransaction when fee is within ceiling", async () => {
      const payer = Keypair.generate().publicKey.toBase58();
      jest
        .spyOn(Connection.prototype, "getBalance")
        .mockResolvedValue(5_000_000_000);
      jest
        .spyOn(Connection.prototype, "getAccountInfo")
        .mockResolvedValue({
          owner: new Keypair().publicKey, // overridden below
        } as any);
      const { TOKEN_PROGRAM_ID } = await import("@/lib/solana/escrowClient");
      (Connection.prototype.getAccountInfo as jest.Mock).mockResolvedValue({
        owner: TOKEN_PROGRAM_ID,
      });
      jest
        .spyOn(Connection.prototype, "getTokenAccountBalance")
        .mockResolvedValue({
          context: { slot: 1 },
          value: { amount: "50000000", decimals: 6, uiAmount: 50 },
        } as any);
      jest
        .spyOn(Connection.prototype, "getLatestBlockhash")
        .mockResolvedValue({
          blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
          lastValidBlockHeight: 200_001,
        });
      jest
        .spyOn(Connection.prototype, "getRecentPrioritizationFees")
        .mockResolvedValue([
          { slot: 1, prioritizationFee: 10_000 },
          { slot: 2, prioritizationFee: 15_000 },
        ]);

      const result = await buildUsdcDepositTransaction({
        payerWallet: payer,
        bookingId: "booking-cap-usdc-1",
        amount: 10,
        currency: "USDC",
        rpcUrl: "https://api.devnet.solana.com",
        maxPriorityFeeMicroLamports: 50_000,
      });

      expect(result.priorityFeeDiagnostics).toEqual({
        estimatedMicroLamports: 15_000,
        maxPriorityFeeMicroLamports: 50_000,
        appliedMicroLamports: 15_000,
        wasCapped: false,
      });

      const tx = Transaction.from(
        Buffer.from(result.serializedTransaction, "base64"),
      );
      expect(readComputeUnitPriceMicroLamports(tx)).toBe(15_000);
    });
  });

  describe("settlement transaction builders and client", () => {
    it("caps estimated priority fee in buildReleaseTransaction and buildRefundTransaction", async () => {
      const authority = Keypair.generate().publicKey.toBase58();
      const recipient = Keypair.generate().publicKey.toBase58();
      jest
        .spyOn(Connection.prototype, "getLatestBlockhash")
        .mockResolvedValue({
          blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
          lastValidBlockHeight: 200_002,
        });
      jest
        .spyOn(Connection.prototype, "getRecentPrioritizationFees")
        .mockResolvedValue([
          { slot: 1, prioritizationFee: 90_000 },
          { slot: 2, prioritizationFee: 180_000 },
        ]);

      const releaseRes = await buildReleaseTransaction({
        bookingId: "book-rel-cap",
        checkInTimestamp: 1_700_000_000,
        recipientWallet: recipient,
        authorityWallet: authority,
        rpcUrl: "https://api.devnet.solana.com",
        maxPriorityFeeMicroLamports: 40_000,
      });

      expect(releaseRes.priorityFeeDiagnostics).toEqual({
        estimatedMicroLamports: 180_000,
        maxPriorityFeeMicroLamports: 40_000,
        appliedMicroLamports: 40_000,
        wasCapped: true,
      });
      expect(readComputeUnitPriceMicroLamports(releaseRes.transaction)).toBe(
        40_000,
      );

      const refundRes = await buildRefundTransaction({
        bookingId: "book-ref-cap",
        reason: "Venue closed",
        closureTimestamp: 1_700_000_000,
        depositorWallet: recipient,
        authorityWallet: authority,
        rpcUrl: "https://api.devnet.solana.com",
        maxPriorityFeeMicroLamports: 25_000,
      });

      expect(refundRes.priorityFeeDiagnostics).toEqual({
        estimatedMicroLamports: 180_000,
        maxPriorityFeeMicroLamports: 25_000,
        appliedMicroLamports: 25_000,
        wasCapped: true,
      });
      expect(readComputeUnitPriceMicroLamports(refundRes.transaction)).toBe(
        25_000,
      );
    });

    it("caps dynamically estimated fee in SolanaEscrowClient.settleEscrow", async () => {
      const escrow: EscrowRecord = {
        escrowId: "escrow-cap-1",
        state: "funded",
        totalLamports: 1_000_000_000n,
        nomadRefundLamports: 0n,
        venuePayoutLamports: 0n,
        fundedAtUnixSeconds: 1_700_000_000,
        gracePeriodSeconds: 900,
        hostCheckedIn: false,
        updatedAtUnixSeconds: 1_700_000_000,
      };

      const submitSettlement = jest
        .fn()
        .mockResolvedValue({ txSignature: "sig-capped-settlement" });
      const estimatePriorityFee = jest.fn().mockResolvedValue(220_000);

      const client = new SolanaEscrowClient(
        { estimatePriorityFee, submitSettlement },
        [escrow],
      );

      const receipt = await client.settleEscrow({
        escrowId: "escrow-cap-1",
        targetState: "released",
        idempotencyKey: "idem-cap-1",
        maxPriorityFeeMicroLamports: 35_000,
      });

      expect(receipt.priorityFeeDiagnostics).toEqual({
        estimatedMicroLamports: 220_000,
        maxPriorityFeeMicroLamports: 35_000,
        appliedMicroLamports: 35_000,
        wasCapped: true,
      });
      expect(submitSettlement).toHaveBeenCalledWith(
        expect.objectContaining({ escrowId: "escrow-cap-1", state: "released" }),
        "idem-cap-1",
        expect.objectContaining({
          priorityFeeMicroLamports: 35_000,
          priorityFeeDiagnostics: receipt.priorityFeeDiagnostics,
        }),
      );
    });
  });
});
