/**
 * Tests for the Solana escrow client and API route.
 *
 * All Solana SDK calls are mocked — no real network or wallet interactions.
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

import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports that touch @solana/web3.js
// ---------------------------------------------------------------------------

const mockGetLatestBlockhash = jest.fn().mockResolvedValue({
  blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
  lastValidBlockHeight: 200_000,
});

const mockGetSignatureStatus = jest.fn();
const mockGetParsedTransaction = jest.fn();

jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getLatestBlockhash: mockGetLatestBlockhash,
      getSignatureStatus: mockGetSignatureStatus,
      getParsedTransaction: mockGetParsedTransaction,
    })),
  };
});

// Mock Clerk auth
jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
  currentUser: jest.fn(),
}));

// Mock Prisma
jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    checkIn: {
      findFirst: jest.fn(),
    },
  },
}));

// Mock rate limiter — always allow in tests
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import {
  deriveEscrowPDA,
  toBaseUnits,
  validateDepositParams,
  buildSolDepositTransaction,
  buildUsdcDepositTransaction,
  buildDepositTransaction,
  confirmTransaction,
  verifyDeposit,
  releaseEscrow,
  refundEscrow,
  createReleaseInstruction,
  createRefundInstruction,
  buildReleaseTransaction,
  buildRefundTransaction,
  verifyCheckInForBooking,
  verifyVenueClosureForBooking,
  recordEscrowState,
  getEscrowState,
  ESCROW_DISCRIMINATORS,
  USDC_DECIMALS,
  ESCROW_PROGRAM_ID,
  type EscrowDepositParams,
} from "@/lib/solana/escrowClient";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const VALID_BOOKING_ID = "cltest123booking";
const VALID_RPC = "https://api.devnet.solana.com";

const validParams: EscrowDepositParams = {
  payerWallet: VALID_WALLET,
  bookingId: VALID_BOOKING_ID,
  amount: 1.5,
  currency: "SOL",
  rpcUrl: VALID_RPC,
};

// ===========================================================================
// § PDA Derivation
// ===========================================================================

describe("deriveEscrowPDA", () => {
  it("returns a valid PublicKey and bump for a booking ID", () => {
    const { address, bump } = deriveEscrowPDA("booking-001");
    expect(address).toBeInstanceOf(PublicKey);
    expect(typeof bump).toBe("number");
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it("produces deterministic results for the same booking ID", () => {
    const a = deriveEscrowPDA("booking-abc");
    const b = deriveEscrowPDA("booking-abc");
    expect(a.address.toBase58()).toBe(b.address.toBase58());
    expect(a.bump).toBe(b.bump);
  });

  it("produces different PDAs for different booking IDs", () => {
    const a = deriveEscrowPDA("booking-1");
    const b = deriveEscrowPDA("booking-2");
    expect(a.address.toBase58()).not.toBe(b.address.toBase58());
  });

  it("throws on empty bookingId", () => {
    expect(() => deriveEscrowPDA("")).toThrow("bookingId is required");
  });

  it("throws on non-string bookingId", () => {
    // @ts-expect-error Testing invalid input
    expect(() => deriveEscrowPDA(null)).toThrow("bookingId is required");
  });

  it("uses ESCROW_PROGRAM_ID for derivation", () => {
    // The PDA should be derivable against the program ID
    const { address } = deriveEscrowPDA("test-booking");
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("worksphere_escrow"), Buffer.from("test-booking")],
      ESCROW_PROGRAM_ID,
    );
    expect(address.toBase58()).toBe(expected.toBase58());
  });
});

// ===========================================================================
// § Amount Conversion
// ===========================================================================

describe("toBaseUnits", () => {
  it("converts SOL to lamports correctly", () => {
    expect(toBaseUnits(1, "SOL")).toBe(BigInt(LAMPORTS_PER_SOL));
    expect(toBaseUnits(0.5, "SOL")).toBe(BigInt(LAMPORTS_PER_SOL / 2));
    expect(toBaseUnits(0.001, "SOL")).toBe(BigInt(1_000_000));
  });

  it("converts USDC to base units correctly", () => {
    expect(toBaseUnits(1, "USDC")).toBe(BigInt(10 ** USDC_DECIMALS));
    expect(toBaseUnits(10.5, "USDC")).toBe(BigInt(10_500_000));
    expect(toBaseUnits(0.01, "USDC")).toBe(BigInt(10_000));
  });

  it("uses integer lamports — no floating-point leakage", () => {
    // 0.1 + 0.2 ≠ 0.3 in IEEE 754, but Math.round should fix this
    const result = toBaseUnits(0.1, "SOL");
    expect(result).toBe(BigInt(100_000_000));
  });

  it("rejects zero amount", () => {
    expect(() => toBaseUnits(0, "SOL")).toThrow("Invalid amount");
  });

  it("rejects negative amount", () => {
    expect(() => toBaseUnits(-1, "USDC")).toThrow("Invalid amount");
  });

  it("rejects NaN", () => {
    expect(() => toBaseUnits(NaN, "SOL")).toThrow("Invalid amount");
  });

  it("rejects Infinity", () => {
    expect(() => toBaseUnits(Infinity, "USDC")).toThrow("Invalid amount");
  });

  it("rejects -Infinity", () => {
    expect(() => toBaseUnits(-Infinity, "SOL")).toThrow("Invalid amount");
  });
});

// ===========================================================================
// § Input Validation
// ===========================================================================

describe("validateDepositParams", () => {
  it("accepts valid SOL params", () => {
    expect(validateDepositParams(validParams)).toEqual({ valid: true });
  });

  it("accepts valid USDC params", () => {
    expect(
      validateDepositParams({ ...validParams, currency: "USDC" }),
    ).toEqual({ valid: true });
  });

  it("rejects missing payerWallet", () => {
    const result = validateDepositParams({
      ...validParams,
      payerWallet: "",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("payerWallet");
  });

  it("rejects invalid base58 wallet address", () => {
    const result = validateDepositParams({
      ...validParams,
      payerWallet: "not-a-real-address!!!",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid payerWallet");
  });

  it("rejects missing bookingId", () => {
    const result = validateDepositParams({
      ...validParams,
      bookingId: "",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("bookingId");
  });

  it("rejects zero amount", () => {
    const result = validateDepositParams({ ...validParams, amount: 0 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("amount");
  });

  it("rejects negative amount", () => {
    const result = validateDepositParams({ ...validParams, amount: -5 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("amount");
  });

  it("rejects invalid currency", () => {
    const result = validateDepositParams({
      ...validParams,
      currency: "ETH" as "SOL",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("currency");
  });

  it("rejects missing rpcUrl", () => {
    const result = validateDepositParams({
      ...validParams,
      rpcUrl: "",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("rpcUrl");
  });
});

// ===========================================================================
// § SOL Deposit Transaction Construction
// ===========================================================================

describe("buildSolDepositTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
      lastValidBlockHeight: 200_000,
    });
  });

  it("returns a base64 serialized transaction", async () => {
    const result = await buildSolDepositTransaction(validParams);
    expect(typeof result.serializedTransaction).toBe("string");
    // Verify it's valid base64
    const decoded = Buffer.from(result.serializedTransaction, "base64");
    expect(decoded.length).toBeGreaterThan(0);
  });

  it("returns the escrow vault PDA address", async () => {
    const result = await buildSolDepositTransaction(validParams);
    expect(typeof result.escrowVault).toBe("string");
    // Should be a valid base58 PublicKey
    expect(() => new PublicKey(result.escrowVault)).not.toThrow();
  });

  it("returns the correct amount in lamports", async () => {
    const result = await buildSolDepositTransaction({
      ...validParams,
      amount: 2,
    });
    expect(result.amountBaseUnits).toBe(BigInt(2 * LAMPORTS_PER_SOL));
  });

  it("returns the PDA bump seed", async () => {
    const result = await buildSolDepositTransaction(validParams);
    expect(result.escrowBump).toBeGreaterThanOrEqual(0);
    expect(result.escrowBump).toBeLessThanOrEqual(255);
  });

  it("returns the recent blockhash", async () => {
    const result = await buildSolDepositTransaction(validParams);
    expect(result.recentBlockhash).toBe(
      "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
    );
  });

  it("throws on invalid params", async () => {
    await expect(
      buildSolDepositTransaction({ ...validParams, amount: -1 }),
    ).rejects.toThrow("Validation failed");
  });

  it("produces a transaction that can be deserialized", async () => {
    const result = await buildSolDepositTransaction(validParams);
    const { Transaction } = jest.requireActual("@solana/web3.js");
    const tx = Transaction.from(
      Buffer.from(result.serializedTransaction, "base64"),
    );
    expect(tx.instructions.length).toBeGreaterThanOrEqual(1);
    expect(tx.feePayer?.toBase58()).toBe(VALID_WALLET);
  });

  it("escrow vault matches PDA for the same booking", async () => {
    const result = await buildSolDepositTransaction(validParams);
    const { address } = deriveEscrowPDA(VALID_BOOKING_ID);
    expect(result.escrowVault).toBe(address.toBase58());
  });
});

// ===========================================================================
// § USDC Deposit Transaction Construction
// ===========================================================================

describe("buildUsdcDepositTransaction", () => {
  const usdcParams: EscrowDepositParams = {
    ...validParams,
    currency: "USDC",
    amount: 25,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
      lastValidBlockHeight: 200_000,
    });
  });

  it("returns a base64 serialized transaction", async () => {
    const result = await buildUsdcDepositTransaction(usdcParams);
    expect(typeof result.serializedTransaction).toBe("string");
    const decoded = Buffer.from(result.serializedTransaction, "base64");
    expect(decoded.length).toBeGreaterThan(0);
  });

  it("returns the correct amount in USDC base units", async () => {
    const result = await buildUsdcDepositTransaction(usdcParams);
    expect(result.amountBaseUnits).toBe(BigInt(25 * 10 ** USDC_DECIMALS));
  });

  it("throws on invalid params", async () => {
    await expect(
      buildUsdcDepositTransaction({ ...usdcParams, payerWallet: "" }),
    ).rejects.toThrow("Validation failed");
  });
});

// ===========================================================================
// § Unified Deposit Builder
// ===========================================================================

describe("buildDepositTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
      lastValidBlockHeight: 200_000,
    });
  });

  it("routes SOL deposits to buildSolDepositTransaction", async () => {
    const result = await buildDepositTransaction(validParams);
    expect(result.amountBaseUnits).toBe(
      BigInt(validParams.amount * LAMPORTS_PER_SOL),
    );
  });

  it("routes USDC deposits to buildUsdcDepositTransaction", async () => {
    const result = await buildDepositTransaction({
      ...validParams,
      currency: "USDC",
      amount: 10,
    });
    expect(result.amountBaseUnits).toBe(BigInt(10 * 10 ** USDC_DECIMALS));
  });
});

// ===========================================================================
// § Transaction Serialization (Phantom/Solflare compatibility)
// ===========================================================================

describe("Wallet-compatible serialization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
      lastValidBlockHeight: 200_000,
    });
  });

  it("serialized transaction has no signatures (unsigned)", async () => {
    const result = await buildSolDepositTransaction(validParams);
    const { Transaction } = jest.requireActual("@solana/web3.js");
    const tx = Transaction.from(
      Buffer.from(result.serializedTransaction, "base64"),
    );
    // Unsigned transactions have zero-filled signature slots
    expect(tx.signatures.length).toBeGreaterThan(0);
    for (const sig of tx.signatures) {
      const sigBytes = sig.signature;
      if (sigBytes) {
        // All bytes should be zero (unsigned placeholder)
        expect(Buffer.from(sigBytes).every((b: number) => b === 0)).toBe(true);
      }
    }
  });

  it("sets the feePayer correctly", async () => {
    const result = await buildSolDepositTransaction(validParams);
    const { Transaction } = jest.requireActual("@solana/web3.js");
    const tx = Transaction.from(
      Buffer.from(result.serializedTransaction, "base64"),
    );
    expect(tx.feePayer?.toBase58()).toBe(VALID_WALLET);
  });
});

// ===========================================================================
// § Transaction Confirmation
// ===========================================================================

describe("confirmTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns confirmed for finalized transaction", async () => {
    mockGetSignatureStatus.mockResolvedValue({
      value: { confirmationStatus: "finalized", err: null },
    });
    const result = await confirmTransaction("fakeSig123", VALID_RPC);
    expect(result.confirmed).toBe(true);
  });

  it("returns confirmed for confirmed transaction", async () => {
    mockGetSignatureStatus.mockResolvedValue({
      value: { confirmationStatus: "confirmed", err: null },
    });
    const result = await confirmTransaction("fakeSig123", VALID_RPC);
    expect(result.confirmed).toBe(true);
  });

  it("rejects transaction with on-chain error", async () => {
    mockGetSignatureStatus.mockResolvedValue({
      value: {
        confirmationStatus: "confirmed",
        err: { InstructionError: [0, "Custom"] },
      },
    });
    const result = await confirmTransaction("fakeSig123", VALID_RPC);
    expect(result.confirmed).toBe(false);
    expect(result.error).toContain("Transaction failed");
  });

  it("rejects when transaction not found", async () => {
    mockGetSignatureStatus.mockResolvedValue({ value: null });
    const result = await confirmTransaction("fakeSig123", VALID_RPC);
    expect(result.confirmed).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("rejects processing (not yet confirmed) status", async () => {
    mockGetSignatureStatus.mockResolvedValue({
      value: { confirmationStatus: "processed", err: null },
    });
    const result = await confirmTransaction("fakeSig123", VALID_RPC);
    expect(result.confirmed).toBe(false);
  });

  it("handles RPC errors gracefully", async () => {
    mockGetSignatureStatus.mockRejectedValue(
      new Error("fetch failed: ECONNREFUSED"),
    );
    const result = await confirmTransaction("fakeSig123", VALID_RPC);
    expect(result.confirmed).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("rejects empty signature", async () => {
    const result = await confirmTransaction("", VALID_RPC);
    expect(result.confirmed).toBe(false);
    expect(result.error).toContain("signature is required");
  });

  it("rejects empty RPC URL", async () => {
    const result = await confirmTransaction("sig", "");
    expect(result.confirmed).toBe(false);
    expect(result.error).toContain("RPC URL is required");
  });
});

// ===========================================================================
// § Deposit Verification
// ===========================================================================

describe("verifyDeposit", () => {
  const expectedParams = {
    bookingId: VALID_BOOKING_ID,
    payerWallet: VALID_WALLET,
    amount: 1,
    currency: "SOL" as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects when transaction is not found", async () => {
    mockGetParsedTransaction.mockResolvedValue(null);
    const result = await verifyDeposit("sig123", expectedParams, VALID_RPC);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("rejects when transaction has on-chain error", async () => {
    mockGetParsedTransaction.mockResolvedValue({
      meta: { err: { InstructionError: [0, "Custom"] } },
      transaction: { message: { accountKeys: [] } },
    });
    const result = await verifyDeposit("sig123", expectedParams, VALID_RPC);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("failed on-chain");
  });

  it("rejects when payer is not a signer", async () => {
    const { address: vault } = deriveEscrowPDA(VALID_BOOKING_ID);
    mockGetParsedTransaction.mockResolvedValue({
      meta: { err: null, preBalances: [0, 0], postBalances: [0, 0] },
      transaction: {
        message: {
          accountKeys: [
            {
              pubkey: new PublicKey(VALID_WALLET),
              signer: false,
              writable: true,
            },
            { pubkey: vault, signer: false, writable: true },
          ],
        },
      },
    });
    const result = await verifyDeposit("sig123", expectedParams, VALID_RPC);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("not a signer");
  });

  it("rejects when escrow vault is not in transaction", async () => {
    mockGetParsedTransaction.mockResolvedValue({
      meta: { err: null, preBalances: [0], postBalances: [0] },
      transaction: {
        message: {
          accountKeys: [
            {
              pubkey: new PublicKey(VALID_WALLET),
              signer: true,
              writable: true,
            },
          ],
        },
      },
    });
    const result = await verifyDeposit("sig123", expectedParams, VALID_RPC);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("not found in transaction");
  });

  it("rejects insufficient deposit amount", async () => {
    const { address: vault } = deriveEscrowPDA(VALID_BOOKING_ID);
    mockGetParsedTransaction.mockResolvedValue({
      meta: {
        err: null,
        preBalances: [2_000_000_000, 0],
        postBalances: [1_500_000_000, 100_000_000], // Only 0.1 SOL deposited
      },
      transaction: {
        message: {
          accountKeys: [
            {
              pubkey: new PublicKey(VALID_WALLET),
              signer: true,
              writable: true,
            },
            { pubkey: vault, signer: false, writable: true },
          ],
        },
      },
    });
    const result = await verifyDeposit("sig123", expectedParams, VALID_RPC);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("Insufficient deposit");
  });

  it("verifies a valid SOL deposit", async () => {
    const { address: vault } = deriveEscrowPDA(VALID_BOOKING_ID);
    mockGetParsedTransaction.mockResolvedValue({
      meta: {
        err: null,
        preBalances: [2_000_000_000, 0],
        postBalances: [1_000_000_000, 1_000_000_000],
      },
      transaction: {
        message: {
          accountKeys: [
            {
              pubkey: new PublicKey(VALID_WALLET),
              signer: true,
              writable: true,
            },
            { pubkey: vault, signer: false, writable: true },
          ],
        },
      },
    });
    const result = await verifyDeposit("sig123", expectedParams, VALID_RPC);
    expect(result.verified).toBe(true);
    expect(result.escrowVault).toBe(vault.toBase58());
  });

  it("rejects empty signature", async () => {
    const result = await verifyDeposit("", expectedParams, VALID_RPC);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("signature is required");
  });

  it("handles RPC errors gracefully", async () => {
    mockGetParsedTransaction.mockRejectedValue(new Error("timeout"));
    const result = await verifyDeposit("sig123", expectedParams, VALID_RPC);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("timeout");
  });
});

// ===========================================================================
// § Release & Refund Guards
// ===========================================================================

describe("releaseEscrow", () => {
  it("throws because no on-chain program is deployed", async () => {
    await expect(
      releaseEscrow(VALID_BOOKING_ID, VALID_WALLET, VALID_RPC),
    ).rejects.toThrow("deployed on-chain escrow program");
  });

  it("error message mentions NEXT_PUBLIC_ESCROW_PROGRAM_ID", async () => {
    await expect(
      releaseEscrow(VALID_BOOKING_ID, VALID_WALLET, VALID_RPC),
    ).rejects.toThrow("NEXT_PUBLIC_ESCROW_PROGRAM_ID");
  });
});

describe("refundEscrow", () => {
  it("throws because no on-chain program is deployed", async () => {
    await expect(
      refundEscrow(VALID_BOOKING_ID, VALID_WALLET, VALID_RPC),
    ).rejects.toThrow("deployed on-chain escrow program");
  });

  it("mentions custodial risk in error message", async () => {
    await expect(
      refundEscrow(VALID_BOOKING_ID, VALID_WALLET, VALID_RPC),
    ).rejects.toThrow("custodial and insecure");
  });
});

// ===========================================================================
// § API Route — /api/pay/solana
// ===========================================================================

describe("POST /api/pay/solana", () => {
  // Dynamic import of the route handler
  let POST: (request: Request) => Promise<Response>;

  const { auth } = jest.mocked(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@clerk/nextjs/server"),
  );
  const { prisma } = jest.mocked(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@/lib/prisma"),
  );

  beforeAll(async () => {
    // Set required env var
    process.env.SOLANA_RPC_URL = VALID_RPC;
    const routeModule = await import("@/app/api/pay/solana/route");
    POST = routeModule.POST;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
      lastValidBlockHeight: 200_000,
    });
  });

  function makeRequest(body: unknown): Request {
    return new Request("http://localhost/api/pay/solana", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // --- Authentication ---

  it("returns 401 when not authenticated", async () => {
    auth.mockResolvedValue({ userId: null } as never);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("Unauthorized");
  });

  // --- Booking Ownership ---

  it("returns 404 when booking does not exist", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      makeRequest({
        bookingId: "nonexistent",
        payerWallet: VALID_WALLET,
        amount: 1,
        currency: "SOL",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when user does not own the booking", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "booking1",
      userId: "different_user",
      status: "CONFIRMED",
    });

    const res = await POST(
      makeRequest({
        bookingId: "booking1",
        payerWallet: VALID_WALLET,
        amount: 1,
        currency: "SOL",
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("do not own");
  });

  // --- Cancelled Booking ---

  it("returns 400 when booking is cancelled", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "booking1",
      userId: "user_123",
      status: "CANCELLED",
    });

    const res = await POST(
      makeRequest({
        bookingId: "booking1",
        payerWallet: VALID_WALLET,
        amount: 1,
        currency: "SOL",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("cancelled");
  });

  // --- Validation ---

  it("returns 400 for invalid request body", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    const res = await POST(
      new Request("http://localhost/api/pay/solana", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing required fields", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    const res = await POST(makeRequest({ bookingId: "b1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid currency", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    const res = await POST(
      makeRequest({
        bookingId: "b1",
        payerWallet: VALID_WALLET,
        amount: 1,
        currency: "ETH",
      }),
    );
    expect(res.status).toBe(400);
  });

  // --- Successful Deposit ---

  it("returns serialized transaction for valid SOL deposit", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "booking1",
      userId: "user_123",
      status: "CONFIRMED",
    });

    const res = await POST(
      makeRequest({
        bookingId: "booking1",
        payerWallet: VALID_WALLET,
        amount: 1.5,
        currency: "SOL",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.serializedTransaction).toBeTruthy();
    expect(json.data.escrowVault).toBeTruthy();
    expect(json.data.currency).toBe("SOL");
    expect(json.data.bookingId).toBe("booking1");
  });

  it("returns serialized transaction for valid USDC deposit", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "booking2",
      userId: "user_123",
      status: "CONFIRMED",
    });

    const res = await POST(
      makeRequest({
        bookingId: "booking2",
        payerWallet: VALID_WALLET,
        amount: 25,
        currency: "USDC",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.currency).toBe("USDC");
  });

  // --- RPC Error Handling ---

  it("returns 503 for RPC connection errors", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "booking1",
      userId: "user_123",
      status: "CONFIRMED",
    });
    mockGetLatestBlockhash.mockRejectedValue(
      new Error("fetch failed: ECONNREFUSED"),
    );

    const res = await POST(
      makeRequest({
        bookingId: "booking1",
        payerWallet: VALID_WALLET,
        amount: 1,
        currency: "SOL",
      }),
    );

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("unavailable");
  });

  // --- Confirm Action ---

  it("returns 400 for confirm with missing signature", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    const res = await POST(
      makeRequest({
        action: "confirm",
        bookingId: "b1",
        payerWallet: VALID_WALLET,
        amount: 1,
        currency: "SOL",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("confirms a valid deposit", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "booking1",
      userId: "user_123",
      status: "CONFIRMED",
    });
    mockGetSignatureStatus.mockResolvedValue({
      value: { confirmationStatus: "finalized", err: null },
    });

    const { address: vault } = deriveEscrowPDA("booking1");
    mockGetParsedTransaction.mockResolvedValue({
      meta: {
        err: null,
        preBalances: [2_000_000_000, 0],
        postBalances: [1_000_000_000, 1_000_000_000],
      },
      transaction: {
        message: {
          accountKeys: [
            {
              pubkey: new PublicKey(VALID_WALLET),
              signer: true,
              writable: true,
            },
            { pubkey: vault, signer: false, writable: true },
          ],
        },
      },
    });

    const res = await POST(
      makeRequest({
        action: "confirm",
        bookingId: "booking1",
        payerWallet: VALID_WALLET,
        amount: 1,
        currency: "SOL",
        signature: "5wHu1qwD7q4G4bPnCtQBHQFn3Ey4pFpwKGwXJvZe9Rdpf",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.confirmed).toBe(true);
  });

  // --- Release Action ---

  it("returns 401 for release when unauthenticated", async () => {
    auth.mockResolvedValue({ userId: null } as never);
    const res = await POST(
      makeRequest({
        action: "release",
        bookingId: "b1",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for release when booking does not exist", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      makeRequest({
        action: "release",
        bookingId: "nonexistent",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 for release when caller is not owner or admin", async () => {
    auth.mockResolvedValue({ userId: "stranger" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      userId: "user_123",
      venue: { id: "v1", ownerId: "venue_owner" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      isAdmin: false,
    });

    const res = await POST(
      makeRequest({
        action: "release",
        bookingId: "b1",
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Unauthorized");
  });

  it("returns 400 for release when trusted check-in is not recorded in ledger", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      userId: "user_123",
      venueId: "v1",
      status: "CONFIRMED",
      venue: { id: "v1", ownerId: "venue_owner" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      isAdmin: false,
    });
    // No active CheckIn found
    (prisma.checkIn.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      makeRequest({
        action: "release",
        bookingId: "b1",
        // Client attempting to fake check-in via GPS
        clientGps: { latitude: 37.7749, longitude: -122.4194 },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("check-in");
  });

  it("returns 400 for duplicate release", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "already_released_booking",
      userId: "user_123",
      venueId: "v1",
      status: "CONFIRMED",
      venue: { id: "v1", ownerId: "venue_owner" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      isAdmin: false,
    });
    (prisma.checkIn.findFirst as jest.Mock).mockResolvedValue({
      createdAt: new Date(),
    });

    recordEscrowState("already_released_booking", "RELEASED");

    const res = await POST(
      makeRequest({
        action: "release",
        bookingId: "already_released_booking",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("already been released");
  });

  it("returns 503 blocked status for release when on-chain program is unconfigured", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "b_valid_checkin",
      userId: "user_123",
      venueId: "v1",
      status: "CONFIRMED",
      venue: { id: "v1", ownerId: "venue_owner" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      isAdmin: false,
    });
    (prisma.checkIn.findFirst as jest.Mock).mockResolvedValue({
      createdAt: new Date(),
    });

    // Reset escrow state to active
    recordEscrowState("b_valid_checkin", "ACTIVE");

    const res = await POST(
      makeRequest({
        action: "release",
        bookingId: "b_valid_checkin",
      }),
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.blocked).toBe(true);
    expect(json.reason).toBe("MISSING_ON_CHAIN_PROGRAM");
  });

  // --- Refund Action ---

  it("returns 401 for refund when unauthenticated", async () => {
    auth.mockResolvedValue({ userId: null } as never);
    const res = await POST(
      makeRequest({
        action: "refund",
        bookingId: "b1",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for refund when caller is not owner or admin", async () => {
    auth.mockResolvedValue({ userId: "stranger" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "b1",
      userId: "user_123",
      venue: { id: "v1", ownerId: "venue_owner" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      isAdmin: false,
    });

    const res = await POST(
      makeRequest({
        action: "refund",
        bookingId: "b1",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for refund when venue closure is not verified", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "b_active",
      userId: "user_123",
      venueId: "v1",
      status: "CONFIRMED", // active, not cancelled
      venue: { id: "v1", name: "Cafe", ownerId: "venue_owner" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      isAdmin: false,
    });

    const res = await POST(
      makeRequest({
        action: "refund",
        bookingId: "b_active",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("closed");
  });

  it("returns 400 for refund when escrow was already released", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "b_released_earlier",
      userId: "user_123",
      venueId: "v1",
      status: "CANCELLED",
      venue: { id: "v1", ownerId: "venue_owner" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      isAdmin: false,
    });

    recordEscrowState("b_released_earlier", "RELEASED");

    const res = await POST(
      makeRequest({
        action: "refund",
        bookingId: "b_released_earlier",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("already been released");
  });

  it("returns 503 blocked status for refund when on-chain program is unconfigured", async () => {
    auth.mockResolvedValue({ userId: "user_123" } as never);
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
      id: "b_cancelled_closure",
      userId: "user_123",
      venueId: "v1",
      status: "CANCELLED",
      venue: { id: "v1", ownerId: "venue_owner" },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      isAdmin: false,
    });

    recordEscrowState("b_cancelled_closure", "ACTIVE");

    const res = await POST(
      makeRequest({
        action: "refund",
        bookingId: "b_cancelled_closure",
      }),
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.blocked).toBe(true);
    expect(json.reason).toBe("MISSING_ON_CHAIN_PROGRAM");
  });
});

// ===========================================================================
// § On-Chain Anchor Instructions & Trusted Verification Unit Tests
// ===========================================================================

describe("Anchor On-Chain Instructions & Verification", () => {
  const recipientKey = new PublicKey("4sj1hqUXasW44qUiXtx47h14UHJbQhmcfGuNMLTzwanu");
  const authorityKey = new PublicKey(VALID_WALLET);

  it("creates release instruction with correct Anchor discriminator and accounts", () => {
    const ix = createReleaseInstruction({
      bookingId: "book-rel-1",
      checkInTimestamp: 1700000000,
      recipientWallet: recipientKey,
      authorityWallet: authorityKey,
    });

    expect(ix.programId.toBase58()).toBe(ESCROW_PROGRAM_ID.toBase58());
    expect(ix.keys.length).toBe(4);
    expect(ix.keys[1].pubkey.toBase58()).toBe(authorityKey.toBase58());
    expect(ix.keys[1].isSigner).toBe(true);
    expect(ix.keys[2].pubkey.toBase58()).toBe(recipientKey.toBase58());
    expect(ix.keys[2].isWritable).toBe(true);

    // Verify Anchor 8-byte discriminator
    const disc = ix.data.subarray(0, 8);
    expect(disc).toEqual(ESCROW_DISCRIMINATORS.release);
  });

  it("creates refund instruction with correct Anchor discriminator and accounts", () => {
    const ix = createRefundInstruction({
      bookingId: "book-ref-1",
      reason: "Emergency closure",
      closureTimestamp: 1700001000,
      depositorWallet: recipientKey,
      authorityWallet: authorityKey,
    });

    expect(ix.programId.toBase58()).toBe(ESCROW_PROGRAM_ID.toBase58());
    expect(ix.keys.length).toBe(4);
    expect(ix.keys[1].pubkey.toBase58()).toBe(authorityKey.toBase58());
    expect(ix.keys[1].isSigner).toBe(true);
    expect(ix.keys[2].pubkey.toBase58()).toBe(recipientKey.toBase58());

    const disc = ix.data.subarray(0, 8);
    expect(disc).toEqual(ESCROW_DISCRIMINATORS.refund);
  });

  it("builds a release transaction with recent blockhash and feePayer", async () => {
    const res = await buildReleaseTransaction({
      bookingId: "book-tx-rel",
      checkInTimestamp: 1700000000,
      recipientWallet: recipientKey.toBase58(),
      authorityWallet: authorityKey.toBase58(),
      rpcUrl: VALID_RPC,
    });

    expect(res.serializedTransaction).toBeTruthy();
    expect(res.escrowVault).toBeTruthy();
    expect(res.transaction.instructions.length).toBe(1);
    expect(res.transaction.feePayer?.toBase58()).toBe(authorityKey.toBase58());
  });

  it("builds a refund transaction with recent blockhash and feePayer", async () => {
    const res = await buildRefundTransaction({
      bookingId: "book-tx-ref",
      reason: "Weather closure",
      closureTimestamp: 1700000000,
      depositorWallet: recipientKey.toBase58(),
      authorityWallet: authorityKey.toBase58(),
      rpcUrl: VALID_RPC,
    });

    expect(res.serializedTransaction).toBeTruthy();
    expect(res.escrowVault).toBeTruthy();
    expect(res.transaction.instructions.length).toBe(1);
    expect(res.transaction.feePayer?.toBase58()).toBe(authorityKey.toBase58());
  });

  it("verifyCheckInForBooking verifies active server check-in and rejects fake GPS", async () => {
    const mockPrisma = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          id: "bk_1",
          userId: "usr_1",
          venueId: "ven_1",
          status: "CONFIRMED",
        }),
      },
      checkIn: {
        findFirst: jest.fn().mockResolvedValue({
          createdAt: new Date(1700000000 * 1000),
        }),
      },
    };

    const res = await verifyCheckInForBooking("bk_1", mockPrisma);
    expect(res.verified).toBe(true);
    expect(res.checkInTimestamp).toBe(1700000000);

    // When no check-in exists in ledger
    mockPrisma.checkIn.findFirst.mockResolvedValueOnce(null);
    const failRes = await verifyCheckInForBooking("bk_1", mockPrisma);
    expect(failRes.verified).toBe(false);
    expect(failRes.error).toContain("Client GPS is not accepted as proof");
  });

  it("verifyVenueClosureForBooking verifies cancelled booking as closure proof", async () => {
    const mockPrisma = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          id: "bk_c",
          userId: "usr_1",
          venueId: "ven_1",
          status: "CANCELLED",
        }),
      },
    };

    const res = await verifyVenueClosureForBooking("bk_c", mockPrisma);
    expect(res.verified).toBe(true);
    expect(res.reason).toContain("cancelled");

    // Active booking is not verified
    mockPrisma.booking.findUnique.mockResolvedValueOnce({
      id: "bk_a",
      userId: "usr_1",
      venueId: "ven_1",
      status: "CONFIRMED",
    });
    const failRes = await verifyVenueClosureForBooking("bk_a", mockPrisma);
    expect(failRes.verified).toBe(false);
  });

  it("tracks escrow states and prevents duplicate operations", () => {
    recordEscrowState("escrow-state-test", "ACTIVE");
    expect(getEscrowState("escrow-state-test")).toBe("ACTIVE");

    recordEscrowState("escrow-state-test", "RELEASED");
    expect(getEscrowState("escrow-state-test")).toBe("RELEASED");

    recordEscrowState("escrow-refund-test", "REFUNDED");
    expect(getEscrowState("escrow-refund-test")).toBe("REFUNDED");
  });
});

