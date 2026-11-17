/**
 * Tests for the Solana Escrow SSE Streaming Endpoint and Deposit Registration (#7773).
 *
 * Covers:
 * - GET /api/pay/solana (SSE Streaming)
 *   - Authentication checks (401)
 *   - Validation checks (400) - Base58 format regex validation
 *   - Booking lookup via ID and confirmationId
 *   - Booking ownership verification (404, 403)
 *   - Stored depositTxSignature matching against SolanaEscrow (404, 403)
 *   - Lifetime expiry handling (408 on expired monitoring window)
 *   - Session budget capping (50s serverless cap)
 *   - SSE headers, connected handshake, and event emission
 *   - Updating booking status to CONFIRMED on confirmed/finalized
 * - POST /api/pay/solana with action "register_deposit"
 *   - Authentication and Base58 format validation (400)
 *   - Booking cancellation rejection (400)
 *   - Booking lookup via ID and confirmationId
 *   - On-chain verification via verifyDeposit (400 on not found, failed, wrong signer, wrong vault, insufficient amount)
 *   - Replay protection (409 Conflict if signature registered on another booking)
 *   - Replacement guard (409 Conflict if different signature already registered)
 *   - Idempotent repeated registration with same signature (200)
 *   - Successful deposit registration and SolanaEscrow persistence (200)
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

const mockGetLatestBlockhash = jest.fn().mockResolvedValue({
  blockhash: "GHtXQBtRBcvNx4VdU5KnfQuL1RKJbF1sHhGGbCPNg6cB",
  lastValidBlockHeight: 200_000,
});

const mockGetSignatureStatuses = jest.fn().mockResolvedValue({
  value: [null],
});

const mockGetParsedTransaction = jest.fn();
const mockOnSignatureWithOptions = jest.fn().mockReturnValue(1);
const mockRemoveSignatureListener = jest.fn().mockResolvedValue(undefined);

jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getLatestBlockhash: mockGetLatestBlockhash,
      getSignatureStatuses: mockGetSignatureStatuses,
      getParsedTransaction: mockGetParsedTransaction,
      onSignatureWithOptions: mockOnSignatureWithOptions,
      removeSignatureListener: mockRemoveSignatureListener,
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
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn(),
    },
    solanaEscrow: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
    },
    checkIn: {
      findFirst: jest.fn(),
    },
  },
}));

// Mock rate limiter
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

import { PublicKey } from "@solana/web3.js";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { deriveEscrowPDA } from "@/lib/solana/escrowClient";

const VALID_BOOKING_ID = "clerk_bkg_12345678";
const VALID_CONFIRMATION_ID = "WS-CONF-987654";
const VALID_USER_ID = "user_2testClerkUserId123";
const OTHER_USER_ID = "user_999attackerUser";
const VALID_WALLET = "11111111111111111111111111111111";
const OTHER_WALLET = "6SRe82zRKPkTHRA12kmuHe33CoUJYwara8rjMjZp3ge6";
const VALID_SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJkLSzLj699";
const OTHER_SIGNATURE =
  "4VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJkLSzLj888";

function setupValidParsedTx(
  bookingId: string = VALID_BOOKING_ID,
  payerWallet: string = VALID_WALLET,
) {
  const { address: escrowVault } = deriveEscrowPDA(bookingId);
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
            pubkey: new PublicKey(payerWallet),
            signer: true,
            writable: true,
          },
          {
            pubkey: escrowVault,
            signer: false,
            writable: true,
          },
        ],
      },
    },
  });
}

describe("Solana Escrow Streaming & Registration API (#7773)", () => {
  let GET: (request: Request) => Promise<Response>;
  let POST: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
    const route = await import("@/app/api/pay/solana/route");
    GET = route.GET;
    POST = route.POST;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // POST /api/pay/solana (action: "register_deposit")
  // =========================================================================

  describe('POST /api/pay/solana (action: "register_deposit")', () => {
    function makeRegisterRequest(body: unknown): Request {
      return new Request("http://localhost/api/pay/solana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("returns 401 when unauthenticated", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: null } as never);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/unauthorized/i);
    });

    it("returns 400 when depositTxSignature is invalid Base58 format", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);

      // Signature too short
      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: "invalid-signature",
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid register_deposit request/i);
    });

    it("returns 404 when booking is not found", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
      jest.mocked(prisma.booking.findUnique).mockResolvedValue(null as never);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/booking not found/i);
    });

    it("returns 403 when user does not own the booking", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: OTHER_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest.mocked(prisma.booking.findUnique).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/forbidden/i);
    });

    it("returns 400 when booking is cancelled", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "CANCELLED",
      } as never);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(
        /cannot register deposit for a cancelled booking/i,
      );
    });

    it("returns 409 Conflict when a different signature is already registered for this booking", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest.mocked(prisma.solanaEscrow.findUnique).mockResolvedValue({
        id: "escrow-1",
        bookingId: VALID_BOOKING_ID,
        depositTxSignature: OTHER_SIGNATURE,
        status: "PENDING",
      } as never);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(
        /conflict: a different deposit signature is already registered/i,
      );
    });

    it("returns idempotent 200 when registering the same signature again", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest.mocked(prisma.solanaEscrow.findUnique).mockResolvedValue({
        id: "escrow-1",
        bookingId: VALID_BOOKING_ID,
        depositTxSignature: VALID_SIGNATURE,
        status: "PENDING",
      } as never);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.depositTxSignature).toBe(VALID_SIGNATURE);
    });

    it("returns 409 Conflict when transaction signature is already used on another booking (replay guard)", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      // No escrow for this booking yet
      jest
        .mocked(prisma.solanaEscrow.findUnique)
        .mockResolvedValueOnce(null as never) // findUnique by bookingId
        .mockResolvedValueOnce({
          id: "escrow-other",
          bookingId: "bkg_other_replayed",
          depositTxSignature: VALID_SIGNATURE,
        } as never); // findUnique by depositTxSignature

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(
        /already been registered for another booking/i,
      );
    });

    it("returns 400 when on-chain transaction is not found", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest
        .mocked(prisma.solanaEscrow.findUnique)
        .mockResolvedValue(null as never);
      mockGetParsedTransaction.mockResolvedValue(null);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(
        /Deposit verification failed: Transaction not found on-chain/i,
      );
    });

    it("returns 400 when on-chain transaction has failed", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest
        .mocked(prisma.solanaEscrow.findUnique)
        .mockResolvedValue(null as never);
      mockGetParsedTransaction.mockResolvedValue({
        meta: { err: { InstructionError: [0, "Custom"] } },
        transaction: { message: { accountKeys: [] } },
      });

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Transaction failed on-chain/i);
    });

    it("returns 400 when on-chain transaction fee payer does not match expected wallet", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest
        .mocked(prisma.solanaEscrow.findUnique)
        .mockResolvedValue(null as never);

      // On-chain signer is OTHER_WALLET
      setupValidParsedTx(VALID_BOOKING_ID, OTHER_WALLET);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          payerWallet: VALID_WALLET,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Expected payer is not a signer/i);
    });

    it("returns 400 when on-chain transaction does not transfer to this booking's escrow vault PDA", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest
        .mocked(prisma.solanaEscrow.findUnique)
        .mockResolvedValue(null as never);

      // Vault is derived for a different booking
      setupValidParsedTx("different_booking_id", VALID_WALLET);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(
        /Escrow vault not found in transaction accounts/i,
      );
    });

    it("returns 400 when on-chain deposit amount is insufficient", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest
        .mocked(prisma.solanaEscrow.findUnique)
        .mockResolvedValue(null as never);

      const { address: escrowVault } = deriveEscrowPDA(VALID_BOOKING_ID);
      mockGetParsedTransaction.mockResolvedValue({
        meta: {
          err: null,
          preBalances: [2_000_000_000, 0],
          postBalances: [1_900_000_000, 100_000_000], // Only 0.1 SOL transferred
        },
        transaction: {
          message: {
            accountKeys: [
              {
                pubkey: new PublicKey(VALID_WALLET),
                signer: true,
                writable: true,
              },
              {
                pubkey: escrowVault,
                signer: false,
                writable: true,
              },
            ],
          },
        },
      });

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          amount: 1.0, // Expects 1 SOL = 1_000_000_000 lamports
          currency: "SOL",
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Insufficient deposit/i);
    });

    it("successfully verifies on-chain transaction and registers depositTxSignature into SolanaEscrow", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest
        .mocked(prisma.solanaEscrow.findUnique)
        .mockResolvedValue(null as never);

      setupValidParsedTx(VALID_BOOKING_ID, VALID_WALLET);

      jest.mocked(prisma.solanaEscrow.upsert).mockResolvedValue({
        id: "escrow-1",
        bookingId: VALID_BOOKING_ID,
        depositTxSignature: VALID_SIGNATURE,
        status: "PENDING",
      } as never);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.depositTxSignature).toBe(VALID_SIGNATURE);
      expect(prisma.solanaEscrow.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bookingId: VALID_BOOKING_ID },
          update: expect.objectContaining({
            depositTxSignature: VALID_SIGNATURE,
          }),
        }),
      );
    });

    it("only selects booking fields that exist on the Booking model", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
      jest.mocked(prisma.booking.findUnique).mockResolvedValue(null as never);

      await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_BOOKING_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      // The real Prisma client rejects unknown fields; the mock does not,
      // so check the select itself.
      for (const fn of [prisma.booking.findFirst, prisma.booking.findUnique]) {
        const select = jest.mocked(fn).mock.calls[0]?.[0]?.select ?? {};
        expect(Object.keys(select).sort()).toEqual([
          "confirmationId",
          "id",
          "status",
          "userId",
        ]);
      }
    });

    it("resolves booking using confirmationId if passed instead of database id", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        confirmationId: VALID_CONFIRMATION_ID,
        userId: VALID_USER_ID,
        status: "PENDING",
      } as never);
      jest
        .mocked(prisma.solanaEscrow.findUnique)
        .mockResolvedValue(null as never);

      setupValidParsedTx(VALID_BOOKING_ID, VALID_WALLET);

      jest.mocked(prisma.solanaEscrow.upsert).mockResolvedValue({
        id: "escrow-1",
        bookingId: VALID_BOOKING_ID,
        depositTxSignature: VALID_SIGNATURE,
        status: "PENDING",
      } as never);

      const res = await POST(
        makeRegisterRequest({
          action: "register_deposit",
          bookingId: VALID_CONFIRMATION_ID,
          depositTxSignature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.bookingId).toBe(VALID_BOOKING_ID);
    });
  });

  // =========================================================================
  // GET /api/pay/solana (SSE Streaming)
  // =========================================================================

  describe("GET /api/pay/solana (SSE Streaming)", () => {
    function makeGetRequest(params: Record<string, string>): Request {
      const url = new URL("http://localhost/api/pay/solana");
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      return new Request(url.toString(), {
        method: "GET",
      });
    }

    it("returns 401 when unauthenticated", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: null } as never);

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/unauthorized/i);
    });

    it("returns 400 when signature has invalid Base58 format", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: "not-a-valid-solana-sig",
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid query parameters/i);
    });

    it("returns 404 when booking does not exist", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
      jest.mocked(prisma.booking.findUnique).mockResolvedValue(null as never);

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/booking not found/i);
    });

    it("returns 403 when user does not own the booking", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: OTHER_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
      } as never);
      jest.mocked(prisma.booking.findUnique).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
      } as never);

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/forbidden/i);
    });

    it("returns 404 when no SolanaEscrow record is found for the booking", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
      } as never);
      jest
        .mocked(prisma.solanaEscrow.findUnique)
        .mockResolvedValue(null as never);

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/no escrow record registered/i);
    });

    it("returns 403 when requested signature does not match stored depositTxSignature", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
      } as never);
      jest.mocked(prisma.solanaEscrow.findUnique).mockResolvedValue({
        id: "escrow-1",
        depositTxSignature: VALID_SIGNATURE,
        status: "PENDING",
        createdAt: new Date(),
      } as never);

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: OTHER_SIGNATURE,
        }),
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/does not match stored deposit signature/i);
    });

    it("returns 408 when escrow confirmation monitoring window has expired (durable lifetime check)", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
      } as never);

      // Escrow created 65 seconds ago (exceeding 60s lifetime)
      const expiredDate = new Date(Date.now() - 65_000);
      jest.mocked(prisma.solanaEscrow.findUnique).mockResolvedValue({
        id: "escrow-1",
        depositTxSignature: VALID_SIGNATURE,
        status: "PENDING",
        createdAt: expiredDate,
      } as never);

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(408);
      const json = await res.json();
      expect(json.error).toMatch(/monitoring window has expired/i);
    });

    it("returns 200 with text/event-stream headers and connected event for authorized requester", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
      } as never);
      jest.mocked(prisma.solanaEscrow.findUnique).mockResolvedValue({
        id: "escrow-1",
        depositTxSignature: VALID_SIGNATURE,
        status: "PENDING",
        createdAt: new Date(),
      } as never);

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: VALID_SIGNATURE,
        }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toContain("no-cache");
      expect(res.headers.get("Connection")).toBe("keep-alive");
      expect(res.headers.get("X-Accel-Buffering")).toBe("no");

      expect(res.body).toBeDefined();
      const reader = res.body!.getReader();
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);

      const decoded = new TextDecoder().decode(chunk.value);
      expect(decoded).toContain("event: connected");
      expect(decoded).toContain(VALID_SIGNATURE);

      await reader.cancel();
    });

    it("keeps the stream open after the connected event while the deposit is pending", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
      } as never);
      jest.mocked(prisma.solanaEscrow.findUnique).mockResolvedValue({
        id: "escrow-1",
        depositTxSignature: VALID_SIGNATURE,
        status: "PENDING",
        createdAt: new Date(),
      } as never);

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: VALID_SIGNATURE,
        }),
      );
      const reader = res.body!.getReader();

      // Read everything the stream produces in the first moment. A failure
      // while the stream is being set up makes a read reject.
      const outcome = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve("still open"), 200);
        const readMore = (): void => {
          reader.read().then(
            ({ done }) => {
              if (done) {
                clearTimeout(timer);
                resolve("closed");
              } else {
                readMore();
              }
            },
            (error: unknown) => {
              clearTimeout(timer);
              resolve(`errored: ${String(error)}`);
            },
          );
        };
        readMore();
      });

      expect(outcome).toBe("still open");
      await reader.cancel();
    });

    it("emits finalized immediately and updates booking status to CONFIRMED when transaction already finalized", async () => {
      jest.mocked(auth).mockResolvedValue({ userId: VALID_USER_ID } as never);
      jest.mocked(prisma.booking.findFirst).mockResolvedValue({
        id: VALID_BOOKING_ID,
        userId: VALID_USER_ID,
      } as never);
      jest.mocked(prisma.solanaEscrow.findUnique).mockResolvedValue({
        id: "escrow-1",
        depositTxSignature: VALID_SIGNATURE,
        status: "PENDING",
        createdAt: new Date(),
      } as never);

      mockGetSignatureStatuses.mockResolvedValueOnce({
        value: [
          {
            slot: 200,
            confirmations: null,
            confirmationStatus: "finalized",
            err: null,
          },
        ],
      });

      const res = await GET(
        makeGetRequest({
          bookingId: VALID_BOOKING_ID,
          signature: VALID_SIGNATURE,
        }),
      );

      const reader = res.body!.getReader();
      let streamOutput = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        streamOutput += new TextDecoder().decode(value);
      }

      expect(streamOutput).toContain("event: connected");
      expect(streamOutput).toContain("event: status");
      expect(streamOutput).toContain('"status":"finalized"');

      // Verify booking status was updated to CONFIRMED in Prisma
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: VALID_BOOKING_ID },
          data: { status: "CONFIRMED" },
        }),
      );
    });
  });
});
