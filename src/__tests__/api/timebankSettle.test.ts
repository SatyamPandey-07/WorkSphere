/** @jest-environment node */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { POST } from "@/app/api/barter/settle/route";
import { prisma } from "@/lib/prisma";
import {
  IOUCryptographicSigner,
  type IOUPayload,
} from "@/core/ledger/IOUCryptographicSigner";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    barterAgreement: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    timebankSettlement: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockAuth = auth as jest.Mock;
const mockFindUnique = prisma.barterAgreement.findUnique as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/barter/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Issue #9585 - Cryptographic TimeBank Settlement & Double-Spend Prevention", () => {
  const providerId = "user_provider_alice";
  const receiverId = "user_receiver_bob";
  const agreementId = "agr_p2p_456";
  const amountMinutes = 30;
  const timestamp = 1730000000000;
  const nonce = "test-nonce-123";

  let providerSigner: IOUCryptographicSigner;
  let receiverSigner: IOUCryptographicSigner;
  let providerPubKey: string;
  let receiverPubKey: string;
  let validProviderSig: string;
  let validReceiverSig: string;

  beforeAll(async () => {
    providerSigner = new IOUCryptographicSigner(providerId);
    receiverSigner = new IOUCryptographicSigner(receiverId);

    await providerSigner.generateKeyPair();
    await receiverSigner.generateKeyPair();

    providerPubKey = await providerSigner.exportPublicKey();
    receiverPubKey = await receiverSigner.exportPublicKey();

    const payload: IOUPayload = {
      agreementId,
      providerId,
      receiverId,
      amountMinutes,
      timestamp,
      nonce,
    };

    validProviderSig = await providerSigner.signIOU(payload);
    validReceiverSig = await receiverSigner.signIOU(payload);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: providerId });
    mockFindUnique.mockResolvedValue(null);
  });

  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await POST(
      createRequest({
        agreementId,
        providerSignature: validProviderSig,
        receiverSignature: validReceiverSig,
        timestamp,
      }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("rejects missing required settlement fields with 400 Bad Request", async () => {
    const res = await POST(
      createRequest({
        agreementId,
        // missing providerSignature and receiverSignature
        timestamp,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/missing required fields/i);
  });

  it("returns 404 Not Found when barter agreement does not exist in DB", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(
      createRequest({
        agreementId: "agr-nonexistent",
        providerSignature: validProviderSig,
        receiverSignature: validReceiverSig,
        timestamp,
        nonce,
      }),
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/barter agreement not found/i);
  });

  it("rejects non-participant callers with 403 Forbidden", async () => {
    mockAuth.mockResolvedValue({ userId: "user_unrelated_intruder" });
    mockFindUnique.mockResolvedValue({
      id: agreementId,
      providerId,
      receiverId,
      amountMinutes,
      state: "COMPLETED",
      providerPubKey,
      receiverPubKey,
    });

    const res = await POST(
      createRequest({
        agreementId,
        providerSignature: validProviderSig,
        receiverSignature: validReceiverSig,
        timestamp,
        nonce,
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/not an authorized participant/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects double-spend attempts with 409 Conflict when agreement is already SETTLED", async () => {
    mockFindUnique.mockResolvedValue({
      id: agreementId,
      providerId,
      receiverId,
      amountMinutes,
      state: "SETTLED", // already settled
      providerPubKey,
      receiverPubKey,
      settlement: { id: "settlement_existing_123" },
    });

    const res = await POST(
      createRequest({
        agreementId,
        providerSignature: validProviderSig,
        receiverSignature: validReceiverSig,
        timestamp,
        nonce,
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("DOUBLE_SPEND_PREVENTED");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects settlement when agreement state is not COMPLETED with 400 Bad Request", async () => {
    mockFindUnique.mockResolvedValue({
      id: agreementId,
      providerId,
      receiverId,
      amountMinutes,
      state: "IN_PROGRESS",
      providerPubKey,
      receiverPubKey,
    });

    const res = await POST(
      createRequest({
        agreementId,
        providerSignature: validProviderSig,
        receiverSignature: validReceiverSig,
        timestamp,
        nonce,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/must be completed/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects invalid or forged cryptographic signatures with 401 Unauthorized", async () => {
    mockFindUnique.mockResolvedValue({
      id: agreementId,
      providerId,
      receiverId,
      amountMinutes,
      state: "COMPLETED",
      providerPubKey,
      receiverPubKey,
    });

    // Provide forged signature
    const forgedSig = "00".repeat(64);

    const res = await POST(
      createRequest({
        agreementId,
        providerSignature: forgedSig,
        receiverSignature: validReceiverSig,
        timestamp,
        nonce,
      }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/invalid cryptographic signatures/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects signature verification when timestamp or nonce was altered in payload", async () => {
    mockFindUnique.mockResolvedValue({
      id: agreementId,
      providerId,
      receiverId,
      amountMinutes,
      state: "COMPLETED",
      providerPubKey,
      receiverPubKey,
    });

    // Valid signatures were made over timestamp 1730000000000; tamper with timestamp
    const res = await POST(
      createRequest({
        agreementId,
        providerSignature: validProviderSig,
        receiverSignature: validReceiverSig,
        timestamp: 1730000099999, // tampered
        nonce,
      }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/invalid cryptographic signatures/i);
  });

  it("verifies genuine ECDSA P-256 signatures and transactionally records settlement", async () => {
    const settledAt = new Date();
    mockFindUnique.mockResolvedValue({
      id: agreementId,
      providerId,
      receiverId,
      amountMinutes,
      state: "COMPLETED",
      providerPubKey,
      receiverPubKey,
    });

    mockTransaction.mockResolvedValue([
      { id: agreementId, state: "SETTLED" },
      {
        id: "settlement_new_789",
        agreementId,
        providerId,
        receiverId,
        amountMinutes,
        providerSig: validProviderSig,
        receiverSig: validReceiverSig,
        nonce,
        settledAt,
      },
    ]);

    const res = await POST(
      createRequest({
        agreementId,
        providerSignature: validProviderSig,
        receiverSignature: validReceiverSig,
        timestamp,
        nonce,
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toMatch(/settlement processed successfully/i);
    expect(json.data.settlementId).toBe("settlement_new_789");
    expect(json.data.amountMinutes).toBe(30);
    expect(mockTransaction).toHaveBeenCalled();
  });
});
