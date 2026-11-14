import { GET } from "@/app/api/cron/escrow-refund/route";
import { prisma } from "@/lib/prisma";
import {
  EscrowRefundSubmissionError,
  isPlaceholderProgramId,
  resolveEscrowAuthorityKeypair,
  submitEscrowRefundTransaction,
  verifyEscrowRefundTransaction,
} from "@/lib/solana/escrowClient";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    solanaEscrow: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/solana/escrowClient", () => {
  class MockEscrowRefundSubmissionError extends Error {
    public readonly phase: string;
    public readonly signature?: string;

    constructor(
      phase: string,
      message: string,
      options: { signature?: string } = {},
    ) {
      super(message);
      this.name = "EscrowRefundSubmissionError";
      this.phase = phase;
      this.signature = options.signature;
    }
  }

  return {
    EscrowRefundSubmissionError: MockEscrowRefundSubmissionError,
    isPlaceholderProgramId: jest.fn(() => false),
    resolveEscrowAuthorityKeypair: jest.fn(() => ({
      publicKey: { toBase58: () => "authority-wallet" },
    })),
    submitEscrowRefundTransaction: jest.fn(),
    verifyEscrowRefundTransaction: jest.fn(),
  };
});

const mockFindMany = prisma.solanaEscrow.findMany as unknown as jest.Mock;
const mockUpdateMany = prisma.solanaEscrow.updateMany as unknown as jest.Mock;
const mockTransaction = prisma.$transaction as unknown as jest.Mock;
const mockSubmit = submitEscrowRefundTransaction as jest.MockedFunction<
  typeof submitEscrowRefundTransaction
>;
const mockVerify = verifyEscrowRefundTransaction as jest.MockedFunction<
  typeof verifyEscrowRefundTransaction
>;
const mockIsPlaceholder = isPlaceholderProgramId as jest.MockedFunction<
  typeof isPlaceholderProgramId
>;
const mockResolveAuthority =
  resolveEscrowAuthorityKeypair as jest.MockedFunction<
    typeof resolveEscrowAuthorityKeypair
  >;

const CRON_URL = "http://localhost/api/cron/escrow-refund";

function cronRequest(secret = "test-secret"): Request {
  return new Request(CRON_URL, {
    headers: { authorization: `Bearer ${secret}` },
  });
}

const expiredEscrow = {
  id: "esc-1",
  bookingId: "booking-1",
  depositorWallet: "depositor-wallet",
  status: "PENDING",
  holdExpiresAt: new Date("2026-11-13T00:00:00Z"),
  refundTxSignature: null,
  refundAttemptedAt: null,
};

const pendingRefundEscrow = {
  id: "esc-old",
  bookingId: "booking-old",
  depositorWallet: "depositor-old",
  status: "REFUND_PENDING",
  holdExpiresAt: new Date("2026-11-12T00:00:00Z"),
  refundTxSignature: "stored-signature",
  refundAttemptedAt: new Date("2026-11-13T00:00:00Z"),
};

describe("GET /api/cron/escrow-refund", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      CRON_SECRET: "test-secret",
      NEXT_PUBLIC_ESCROW_PROGRAM_ID:
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      SOLANA_ESCROW_AUTHORITY_SECRET_KEY: "authority-secret",
    };
    delete process.env.ESCROW_REFUND_CONFIRMATION_TIMEOUT_MS;
    delete process.env.ESCROW_REFUND_POLL_INTERVAL_MS;
    delete process.env.ESCROW_REFUND_STALE_CLAIM_MS;
    delete process.env.ESCROW_REFUND_MAX_RUN_MS;

    mockIsPlaceholder.mockReturnValue(false);
    mockResolveAuthority.mockReturnValue({
      publicKey: { toBase58: () => "authority-wallet" },
    } as never);
    mockVerify.mockResolvedValue({
      status: "unknown",
      signature: "stored-signature",
    });
    mockFindMany.mockResolvedValue([]);
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockSubmit.mockReset();
    mockTransaction.mockImplementation(async (callback: unknown) =>
      (callback as (tx: unknown) => Promise<unknown>)({
        solanaEscrow: { updateMany: mockUpdateMany },
      }),
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("rejects requests without the cron bearer token", async () => {
    const response = await GET(cronRequest("wrong-secret"));
    expect(response.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("returns 503 when the escrow program is not configured", async () => {
    delete process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;

    const response = await GET(cronRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.missing).toContain("NEXT_PUBLIC_ESCROW_PROGRAM_ID");
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("returns 503 when the refund authority key is missing", async () => {
    delete process.env.SOLANA_ESCROW_AUTHORITY_SECRET_KEY;

    const response = await GET(cronRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.missing).toContain("SOLANA_ESCROW_AUTHORITY_SECRET_KEY");
  });

  it("returns 503 when the configured program is still a placeholder", async () => {
    mockIsPlaceholder.mockReturnValue(true);

    const response = await GET(cronRequest());

    expect(response.status).toBe(503);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("does nothing when no escrow is expired or pending reconciliation", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.refunds.refunded).toBe(0);
    expect(body.refunds.skipped).toBe(0);
    expect(body.reconciliation.unknown).toBe(0);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("claims, signs, persists, broadcasts and finalizes one refund", async () => {
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [] : [expiredEscrow],
    );
    mockUpdateMany.mockImplementation(
      async ({ where, data }: { where: any; data: any }) => {
        if (data?.status === "REFUNDED") return { count: 1 };
        if (data?.refundTxSignature) return { count: 1 };
        if (where?.status === "PENDING" && data?.status === "REFUND_PENDING") {
          return { count: 1 };
        }
        return { count: 0 };
      },
    );
    mockSubmit.mockImplementation(async (params) => {
      await params.onSigned?.("refund-signature");
      return { signature: "refund-signature", escrowVault: "vault-address" };
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.refunds.refunded).toBe(1);
    expect(body.refunds.results[0]).toMatchObject({
      escrowId: "esc-1",
      status: "refunded",
      signature: "refund-signature",
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    const signatureCall = mockUpdateMany.mock.calls.findIndex(
      ([args]) => args.data?.refundTxSignature === "refund-signature",
    );
    const finalizeCall = mockUpdateMany.mock.calls.findIndex(
      ([args]) => args.data?.status === "REFUNDED",
    );
    expect(signatureCall).toBeGreaterThanOrEqual(0);
    expect(finalizeCall).toBeGreaterThan(signatureCall);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "esc-1",
        status: "REFUND_PENDING",
        refundAttemptedAt: expect.any(Date),
        refundTxSignature: "refund-signature",
      },
      data: {
        status: "REFUNDED",
        refundedAt: expect.any(Date),
        lastRefundError: null,
      },
    });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("stops starting new refunds when the run budget is exhausted", async () => {
    process.env.ESCROW_REFUND_MAX_RUN_MS = "1";
    const secondEscrow = {
      ...expiredEscrow,
      id: "esc-2",
      bookingId: "booking-2",
    };
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [] : [expiredEscrow, secondEscrow],
    );
    mockUpdateMany.mockImplementation(
      async ({ where, data }: { where: any; data: any }) => {
        if (where?.status === "PENDING" && data?.status === "REFUND_PENDING") {
          return { count: 1 };
        }
        if (data?.status === "REFUNDED") return { count: 1 };
        if (data?.refundTxSignature) return { count: 1 };
        return { count: 0 };
      },
    );
    mockSubmit.mockImplementation(async (params) => {
      await params.onSigned?.("refund-signature");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { signature: "refund-signature", escrowVault: "vault-address" };
    });

    const response = await GET(cronRequest());

    const body = await response.json();
    expect(body.stoppedEarly).toBe(true);
    expect(body.refunds.results).toHaveLength(1);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits only once when concurrent cron runs race for the same escrow", async () => {
    let claimed = false;
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [] : [expiredEscrow],
    );
    mockUpdateMany.mockImplementation(
      async ({ where, data }: { where: any; data: any }) => {
        if (where?.status === "PENDING" && data?.status === "REFUND_PENDING") {
          if (claimed) return { count: 0 };
          claimed = true;
          return { count: 1 };
        }
        if (data?.status === "REFUNDED") return { count: 1 };
        if (data?.refundTxSignature) return { count: 1 };
        return { count: 0 };
      },
    );
    mockSubmit.mockImplementation(async (params) => {
      await params.onSigned?.("refund-signature");
      return { signature: "refund-signature", escrowVault: "vault-address" };
    });

    const [first, second] = await Promise.all([
      GET(cronRequest()),
      GET(cronRequest()),
    ]);
    const bodies = await Promise.all([first.json(), second.json()]);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(
      bodies.reduce((total, body) => total + body.refunds.refunded, 0),
    ).toBe(1);
    expect(
      bodies.reduce((total, body) => total + body.refunds.skipped, 0),
    ).toBe(1);
  });

  it("skips an escrow claimed by another worker", async () => {
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [] : [expiredEscrow],
    );
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const response = await GET(cronRequest());

    const body = await response.json();
    expect(body.refunds.skipped).toBe(1);
    expect(body.refunds.refunded).toBe(0);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("returns the escrow to PENDING when preflight fails before signing", async () => {
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [] : [expiredEscrow],
    );
    mockUpdateMany.mockImplementation(
      async ({ where, data }: { where: any; data: any }) => {
        if (where?.status === "PENDING" && data?.status === "REFUND_PENDING") {
          return { count: 1 };
        }
        return { count: 0 };
      },
    );
    mockSubmit.mockRejectedValue(
      new EscrowRefundSubmissionError("preflight", "program not deployed"),
    );

    const response = await GET(cronRequest());

    const body = await response.json();
    expect(body.refunds.failed).toBe(1);
    expect(mockTransaction).not.toHaveBeenCalled();

    const resetCall = mockUpdateMany.mock.calls.find(
      ([args]) => args.where?.id === "esc-1" && args.data?.status === "PENDING",
    );
    expect(resetCall).toBeDefined();
    expect(resetCall[0].data).toMatchObject({
      status: "PENDING",
      refundTxSignature: null,
    });
  });

  it("keeps a signed escrow claimed when broadcast fails", async () => {
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [] : [expiredEscrow],
    );
    mockUpdateMany.mockImplementation(
      async ({ where, data }: { where: any; data: any }) => {
        if (where?.status === "PENDING" && data?.status === "REFUND_PENDING") {
          return { count: 1 };
        }
        if (data?.refundTxSignature) return { count: 1 };
        return { count: 0 };
      },
    );
    mockSubmit.mockImplementation(async (params) => {
      await params.onSigned?.("broadcast-signature");
      throw new EscrowRefundSubmissionError(
        "broadcast",
        "all RPC endpoints failed",
        { signature: "broadcast-signature" },
      );
    });

    const response = await GET(cronRequest());

    const body = await response.json();
    expect(body.refunds.broadcastFailed).toBe(1);
    expect(body.refunds.results[0].signature).toBe("broadcast-signature");
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(
      mockUpdateMany.mock.calls.some(
        ([args]) =>
          args.where?.id === "esc-1" && args.data?.status === "PENDING",
      ),
    ).toBe(false);
  });

  it("keeps a signed escrow claimed when confirmation times out", async () => {
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [] : [expiredEscrow],
    );
    mockUpdateMany.mockImplementation(
      async ({ where, data }: { where: any; data: any }) => {
        if (where?.status === "PENDING" && data?.status === "REFUND_PENDING") {
          return { count: 1 };
        }
        if (data?.refundTxSignature) return { count: 1 };
        return { count: 0 };
      },
    );
    mockSubmit.mockImplementation(async (params) => {
      await params.onSigned?.("slow-signature");
      throw new EscrowRefundSubmissionError(
        "confirmation",
        "not confirmed within 30000ms",
        { signature: "slow-signature" },
      );
    });

    const response = await GET(cronRequest());

    const body = await response.json();
    expect(body.refunds.pendingConfirmation).toBe(1);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(
      mockUpdateMany.mock.calls.some(
        ([args]) =>
          args.where?.id === "esc-1" && args.data?.status === "PENDING",
      ),
    ).toBe(false);
  });

  it("finalizes an escrow whose stored signature was confirmed", async () => {
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [pendingRefundEscrow] : [],
    );
    mockVerify.mockResolvedValue({
      status: "confirmed",
      signature: "stored-signature",
      slot: 99,
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const response = await GET(cronRequest());

    const body = await response.json();
    expect(body.reconciliation.confirmed).toBe(1);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "esc-old", status: "REFUND_PENDING" },
      data: {
        status: "REFUNDED",
        refundedAt: expect.any(Date),
        lastRefundError: null,
      },
    });
  });

  it("re-queues an escrow whose stored signature failed on-chain", async () => {
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [pendingRefundEscrow] : [],
    );
    mockVerify.mockResolvedValue({
      status: "failed",
      signature: "stored-signature",
      error: "InstructionError",
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const response = await GET(cronRequest());

    const body = await response.json();
    expect(body.reconciliation.failed).toBe(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "esc-old", status: "REFUND_PENDING" },
      data: {
        status: "PENDING",
        refundTxSignature: null,
        lastRefundError: expect.stringContaining("failed on-chain"),
      },
    });
  });

  it("keeps an escrow claimed while its signature is still unknown", async () => {
    mockFindMany.mockImplementation(async ({ where }: { where: any }) =>
      where.status === "REFUND_PENDING" ? [pendingRefundEscrow] : [],
    );
    mockVerify.mockResolvedValue({
      status: "unknown",
      signature: "stored-signature",
    });

    const response = await GET(cronRequest());

    const body = await response.json();
    expect(body.reconciliation.unknown).toBe(1);
    expect(mockUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "esc-old", status: "REFUND_PENDING" },
      }),
    );
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("re-queues stale claims that never produced a signature", async () => {
    mockUpdateMany.mockResolvedValue({ count: 3 });

    const response = await GET(cronRequest());

    const body = await response.json();
    expect(body.recoveredClaims).toBe(3);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        status: "REFUND_PENDING",
        refundTxSignature: null,
        refundAttemptedAt: { lt: expect.any(Date) },
      },
      data: {
        status: "PENDING",
        lastRefundError:
          "Recovered stale refund claim with no signed transaction",
      },
    });
  });
});
