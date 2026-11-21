// Fix jsdom Buffer vs Uint8Array realm mismatch for @noble/curves, which
// backs PublicKey.isOnCurve/findProgramAddressSync. Without this, every PDA
// derivation under jsdom fails with "Unable to find a viable program address
// nonce". The same guard is used by src/__tests__/solana/escrow.test.ts.
Object.defineProperty(Uint8Array, Symbol.hasInstance, {
  value: (instance: unknown) =>
    (instance != null &&
      typeof instance === "object" &&
      (instance.constructor?.name === "Buffer" ||
        instance.constructor?.name === "Uint8Array" ||
        Buffer.isBuffer(instance))) ||
    false,
  configurable: true,
});

import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  EscrowRefundSubmissionError,
  decodeBase58,
  deriveEscrowPDA,
  encodeBase58,
  parseEscrowAuthoritySecretKey,
  resolveEscrowAuthorityKeypair,
  submitEscrowRefundTransaction,
  verifyEscrowRefundTransaction,
} from "@/lib/solana/escrowClient";

interface FakeStatus {
  slot: number;
  err: unknown;
  confirmations: number | null;
  confirmationStatus?: "processed" | "confirmed" | "finalized";
}

function createFakeConnection(options: {
  status?: FakeStatus | null | (() => FakeStatus | null);
  sendError?: Error;
  blockhash?: string;
  events?: string[];
}) {
  const events = options.events ?? [];
  const status = options.status ?? null;
  return {
    getLatestBlockhash: jest.fn(async () => ({
      blockhash: options.blockhash ?? Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 1_000,
    })),
    sendRawTransaction: jest.fn(async (raw: Buffer | Uint8Array) => {
      events.push("send");
      if (options.sendError) throw options.sendError;
      const transaction = Transaction.from(raw);
      return transaction.signature
        ? encodeBase58(new Uint8Array(transaction.signature))
        : "unsigned";
    }),
    getSignatureStatuses: jest.fn(async () => ({
      context: { slot: 1 },
      value: [typeof status === "function" ? status() : status],
    })),
  };
}

function createFakePool(connection: ReturnType<typeof createFakeConnection>) {
  return {
    execute: jest.fn(
      async <T>(
        operation: (connection: unknown, endpoint: string) => Promise<T>,
      ): Promise<T> => operation(connection, "https://rpc.example"),
    ),
  };
}

const FAST_CONFIRMATION = {
  confirmationTimeoutMs: 1_000,
  pollIntervalMs: 1,
  sleep: jest.fn().mockResolvedValue(undefined),
};

describe("escrow refund submission helpers", () => {
  const originalProgramId = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
  const programId = Keypair.generate().publicKey.toBase58();
  const authority = Keypair.generate();
  const depositor = Keypair.generate();
  const bookingId = "booking-7740";

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = programId;
  });

  afterAll(() => {
    if (originalProgramId === undefined) {
      delete process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
    } else {
      process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = originalProgramId;
    }
  });

  describe("base58 codec", () => {
    it("round-trips arbitrary bytes including leading zeros", () => {
      const samples = [
        new Uint8Array([0, 0, 1]),
        new Uint8Array([0]),
        new Uint8Array([255, 254, 253]),
        authority.secretKey,
      ];

      for (const sample of samples) {
        expect(Array.from(decodeBase58(encodeBase58(sample)))).toEqual(
          Array.from(sample),
        );
      }
      expect(encodeBase58(new Uint8Array([0, 0, 1]))).toBe("112");
    });

    it("rejects non-base58 characters", () => {
      expect(() => decodeBase58("0OIl")).toThrow(/Invalid base58/);
    });
  });

  describe("escrow authority key parsing", () => {
    it("parses base58 secret keys", () => {
      const parsed = parseEscrowAuthoritySecretKey(
        encodeBase58(authority.secretKey),
      );
      expect(Array.from(parsed.secretKey)).toEqual(
        Array.from(authority.secretKey),
      );
      expect(parsed.publicKey.toBase58()).toBe(authority.publicKey.toBase58());
    });

    it("parses JSON 64-byte secret key arrays", () => {
      const parsed = parseEscrowAuthoritySecretKey(
        JSON.stringify(Array.from(authority.secretKey)),
      );
      expect(parsed.publicKey.toBase58()).toBe(authority.publicKey.toBase58());
    });

    it("rejects malformed keys without leaking the secret", () => {
      expect(() => parseEscrowAuthoritySecretKey("not-a-key")).toThrow(
        /SOLANA_ESCROW_AUTHORITY_SECRET_KEY is invalid/,
      );
      expect(() => parseEscrowAuthoritySecretKey("[1,2,3]")).toThrow(
        /64 bytes/,
      );
      expect(() => parseEscrowAuthoritySecretKey("[1,2,300]")).toThrow(
        /SOLANA_ESCROW_AUTHORITY_SECRET_KEY is invalid/,
      );
    });

    it("resolves the keypair from env and rejects missing configuration", () => {
      const source = encodeBase58(authority.secretKey);
      expect(resolveEscrowAuthorityKeypair(source).publicKey.toBase58()).toBe(
        authority.publicKey.toBase58(),
      );
      expect(() => resolveEscrowAuthorityKeypair("   ")).toThrow(
        /not configured/,
      );
    });
  });

  it("derives program-specific escrow PDAs", () => {
    const first = deriveEscrowPDA(bookingId, authority.publicKey);
    const second = deriveEscrowPDA(bookingId, depositor.publicKey);
    expect(first.address.toBase58()).not.toBe(second.address.toBase58());
  });

  it("signs before broadcasting and confirms through signature statuses", async () => {
    const events: string[] = [];
    const connection = createFakeConnection({
      events,
      status: {
        slot: 42,
        err: null,
        confirmations: 1,
        confirmationStatus: "confirmed",
      },
    });
    const pool = createFakePool(connection);
    const onSigned = jest.fn(async (signature: string) => {
      events.push(`signed:${signature}`);
    });

    const result = await submitEscrowRefundTransaction({
      bookingId,
      depositorWallet: depositor.publicKey.toBase58(),
      authority,
      programId,
      pool: pool as never,
      onSigned,
      ...FAST_CONFIRMATION,
    });

    expect(result.signature).toBeTruthy();
    expect(result.slot).toBe(42);
    expect(result.escrowVault).toBe(
      deriveEscrowPDA(bookingId, new PublicKey(programId)).address.toBase58(),
    );
    expect(onSigned).toHaveBeenCalledWith(result.signature);
    expect(events).toHaveLength(2);
    expect(events[0]).toBe(`signed:${result.signature}`);
    expect(events[1]).toBe("send");

    const sent = connection.sendRawTransaction.mock.calls[0][0];
    const transaction = Transaction.from(sent as Buffer);
    expect(encodeBase58(new Uint8Array(transaction.signature!))).toBe(
      result.signature,
    );
    expect(transaction.feePayer?.toBase58()).toBe(
      authority.publicKey.toBase58(),
    );
  });

  it("keeps the signed signature when broadcast fails", async () => {
    const connection = createFakeConnection({
      sendError: new Error("503 service unavailable"),
      status: null,
    });
    const pool = createFakePool(connection);
    const onSigned = jest.fn().mockResolvedValue(undefined);

    await expect(
      submitEscrowRefundTransaction({
        bookingId,
        depositorWallet: depositor.publicKey.toBase58(),
        authority,
        pool: pool as never,
        onSigned,
        ...FAST_CONFIRMATION,
      }),
    ).rejects.toMatchObject({
      name: "EscrowRefundSubmissionError",
      phase: "broadcast",
      signature: expect.any(String),
    });

    expect(onSigned).toHaveBeenCalledTimes(1);
    expect(onSigned.mock.calls[0][0]).toEqual(expect.any(String));
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("aborts before broadcast when the signature cannot be persisted", async () => {
    const connection = createFakeConnection({ status: null });
    const pool = createFakePool(connection);

    await expect(
      submitEscrowRefundTransaction({
        bookingId,
        depositorWallet: depositor.publicKey.toBase58(),
        authority,
        pool: pool as never,
        onSigned: jest.fn().mockRejectedValue(new Error("db write failed")),
        ...FAST_CONFIRMATION,
      }),
    ).rejects.toMatchObject({
      phase: "preflight",
      signature: expect.any(String),
    });

    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("raises a confirmation error when the transaction fails on-chain", async () => {
    const connection = createFakeConnection({
      status: {
        slot: 7,
        err: { InstructionError: [0, "Custom"] },
        confirmations: 1,
        confirmationStatus: "confirmed",
      },
    });

    await expect(
      submitEscrowRefundTransaction({
        bookingId,
        depositorWallet: depositor.publicKey.toBase58(),
        authority,
        pool: createFakePool(connection) as never,
        ...FAST_CONFIRMATION,
      }),
    ).rejects.toMatchObject({
      phase: "confirmation",
      signature: expect.any(String),
    });
  });

  it("polls until the confirmation timeout when the signature stays unknown", async () => {
    const connection = createFakeConnection({ status: null });
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      submitEscrowRefundTransaction({
        bookingId,
        depositorWallet: depositor.publicKey.toBase58(),
        authority,
        pool: createFakePool(connection) as never,
        confirmationTimeoutMs: 40,
        pollIntervalMs: 10,
        sleep,
      }),
    ).rejects.toMatchObject({
      phase: "confirmation",
      signature: expect.any(String),
    });

    expect(connection.getSignatureStatuses).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("rejects placeholder program IDs during preflight", async () => {
    delete process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
    const connection = createFakeConnection({ status: null });
    const pool = createFakePool(connection);

    await expect(
      submitEscrowRefundTransaction({
        bookingId,
        depositorWallet: depositor.publicKey.toBase58(),
        authority,
        programId,
        pool: pool as never,
        ...FAST_CONFIRMATION,
      }),
    ).rejects.toMatchObject({ phase: "preflight" });

    expect(pool.execute).not.toHaveBeenCalled();
  });

  it("rejects invalid depositor wallets during preflight", async () => {
    await expect(
      submitEscrowRefundTransaction({
        bookingId,
        depositorWallet: "definitely-not-a-wallet",
        authority,
        pool: createFakePool(createFakeConnection({ status: null })) as never,
        ...FAST_CONFIRMATION,
      }),
    ).rejects.toMatchObject({ phase: "preflight" });
  });

  describe("verifyEscrowRefundTransaction", () => {
    const signature =
      "4hXTCkRzt9WyecNzV1XPgCDfGAZzQKNxLXgynz5QDuKW9qpVBLnjuWZzJZ1xJ9x9x9x9x9x9";

    it.each([
      [
        "confirmed",
        {
          slot: 10,
          err: null,
          confirmations: 1,
          confirmationStatus: "confirmed",
        },
      ],
      [
        "finalized",
        {
          slot: 11,
          err: null,
          confirmations: null,
          confirmationStatus: "finalized",
        },
      ],
    ] as const)(
      "reports %s transactions as confirmed",
      async (_label, status) => {
        const verification = await verifyEscrowRefundTransaction({
          signature,
          pool: createFakePool(createFakeConnection({ status })) as never,
        });
        expect(verification.status).toBe("confirmed");
        expect(verification.slot).toBe(status.slot);
      },
    );

    it("reports reverted transactions as failed", async () => {
      const verification = await verifyEscrowRefundTransaction({
        signature,
        pool: createFakePool(
          createFakeConnection({
            status: {
              slot: 12,
              err: { InstructionError: [1, "InsufficientFunds"] },
              confirmations: 1,
              confirmationStatus: "confirmed",
            },
          }),
        ) as never,
      });
      expect(verification.status).toBe("failed");
      expect(verification.error).toContain("InstructionError");
    });

    it("reports processed transactions as pending", async () => {
      const verification = await verifyEscrowRefundTransaction({
        signature,
        pool: createFakePool(
          createFakeConnection({
            status: {
              slot: 13,
              err: null,
              confirmations: 0,
              confirmationStatus: "processed",
            },
          }),
        ) as never,
      });
      expect(verification.status).toBe("pending");
    });

    it("reports unseen signatures and RPC errors as unknown", async () => {
      const unseen = await verifyEscrowRefundTransaction({
        signature,
        pool: createFakePool(createFakeConnection({ status: null })) as never,
      });
      expect(unseen.status).toBe("unknown");

      const failingPool = {
        execute: jest.fn().mockRejectedValue(new Error("all RPC nodes down")),
      };
      const errored = await verifyEscrowRefundTransaction({
        signature,
        pool: failingPool as never,
      });
      expect(errored.status).toBe("unknown");
      expect(errored.error).toMatch(/all RPC nodes down/);
    });
  });

  it("tags failures with the submission phase", () => {
    const error = new EscrowRefundSubmissionError(
      "confirmation",
      "not confirmed",
      { signature: "sig" },
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.phase).toBe("confirmation");
    expect(error.signature).toBe("sig");
  });
});
