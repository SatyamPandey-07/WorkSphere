import {
  simulateEscrowTransaction,
  reconcilePendingSignature,
} from "@/lib/solana/escrowClient";

describe("Solana Optimistic Escrow Simulation & Reconciler", () => {
  test("returns success: true when transaction simulation consumes 0 units error", async () => {
    const mockConnection: any = {
      simulateTransaction: jest.fn().mockResolvedValue({
        value: { err: null, logs: ["Program log: Instruction: LockEscrow", "Program consumed: 4500 units"] },
      }),
    };

    const mockTx: any = {};
    const result = await simulateEscrowTransaction(mockConnection, mockTx);

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(2);
  });

  test("returns success: false when transaction simulation returns RPC execution error", async () => {
    const mockConnection: any = {
      simulateTransaction: jest.fn().mockResolvedValue({
        value: { err: { InstructionError: [0, "Custom(1)"] }, logs: [] },
      }),
    };

    const mockTx: any = {};
    const result = await simulateEscrowTransaction(mockConnection, mockTx);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("reconciles background signature status successfully upon finalization", async () => {
    const mockConnection: any = {
      getSignatureStatus: jest.fn().mockResolvedValue({
        value: { err: null, confirmationStatus: "finalized" },
      }),
    };

    const isFinalized = await reconcilePendingSignature({
      signature: "mock_signature_abc123",
      connection: mockConnection,
      maxRetries: 1,
      retryIntervalMs: 10,
    });

    expect(isFinalized).toBe(true);
  });
});