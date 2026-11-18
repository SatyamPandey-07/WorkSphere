/**
 * solanaPaymentRpcFailover.test.ts
 * Verifies the status route honours RPC failover semantics (#5364).
 */

import { NextRequest } from "next/server";

jest.mock("@/lib/payments/solanaPay", () => {
  const actual = jest.requireActual("@/lib/payments/solanaPay");
  return {
    ...actual,
    verifySolanaPayment: jest.fn(),
  };
});

import {
  SolanaRpcFailoverError,
  verifySolanaPayment,
} from "@/lib/payments/solanaPay";
import { GET } from "@/app/api/payments/solana/status/route";

const VALID_SIGNATURE = "A".repeat(88);
const mockedVerify = verifySolanaPayment as jest.MockedFunction<
  typeof verifySolanaPayment
>;

function statusRequest(reference: string) {
  return new NextRequest(
    `http://localhost:3000/api/payments/solana/status?reference=${reference}&signature=${VALID_SIGNATURE}`,
  );
}

describe("/api/payments/solana/status RPC failover (#5364)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ENABLE_SOLANA_PAYMENT_SIMULATION;
    mockedVerify.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 503 PROCESSING instead of FAILED when RPC endpoints are exhausted", async () => {
    mockedVerify.mockRejectedValue(
      new SolanaRpcFailoverError([
        { endpoint: "https://primary.example", error: "503 Service Unavailable" },
        { endpoint: "https://secondary.example", error: "429 Too Many Requests" },
      ]),
    );

    const res = await GET(statusRequest("tx_rpc_down_ref"));

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe("PROCESSING");
    expect(data.message).toContain("temporarily unavailable");
  });

  it("returns CONFIRMED when on-chain verification succeeds", async () => {
    mockedVerify.mockResolvedValue({
      status: "CONFIRMED",
      signature: VALID_SIGNATURE,
      slot: 123,
      confirmationStatus: "confirmed",
    });

    const res = await GET(statusRequest("tx_rpc_confirmed_ref"));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("CONFIRMED");
    expect(data.signature).toBe(VALID_SIGNATURE);
    expect(data.slot).toBe(123);
  });

  it("keeps the payment PENDING while the transaction is unconfirmed", async () => {
    mockedVerify.mockResolvedValue({
      status: "PENDING",
      signature: VALID_SIGNATURE,
    });

    const res = await GET(statusRequest("tx_rpc_pending_ref"));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("PENDING");
    expect(data.signature).toBe(VALID_SIGNATURE);
  });

  it("returns FAILED only when the transaction actually failed on-chain", async () => {
    mockedVerify.mockResolvedValue({
      status: "FAILED",
      signature: VALID_SIGNATURE,
      error: "InstructionError",
    });

    const res = await GET(statusRequest("tx_rpc_failed_ref"));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("FAILED");
    expect(data.error).toBe("InstructionError");
  });
});
