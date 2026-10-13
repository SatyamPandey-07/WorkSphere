import { NextRequest } from "next/server";
import { POST } from "@/app/api/payments/micropay/session/route";
import { MicroPaymentEngine } from "@/lib/payments/microPaymentEngine";

function createMockPostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/payments/micropay/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("MicroPaymentEngine - Satoshi Amount Validation (#5274)", () => {
  it("accepts strictly positive integers", () => {
    expect(MicroPaymentEngine.validateSatoshiAmount(1)).toEqual({
      isValid: true,
      sats: 1,
    });
    expect(MicroPaymentEngine.validateSatoshiAmount(1460)).toEqual({
      isValid: true,
      sats: 1460,
    });
    expect(MicroPaymentEngine.validateSatoshiAmount(100000000)).toEqual({
      isValid: true,
      sats: 100000000,
    });
    expect(MicroPaymentEngine.isValidSatoshiAmount(500)).toBe(true);
  });

  it("rejects zero and negative satoshi amounts", () => {
    const resZero = MicroPaymentEngine.validateSatoshiAmount(0);
    expect(resZero.isValid).toBe(false);
    expect(resZero.error).toMatch(/strictly positive/i);

    const resNeg = MicroPaymentEngine.validateSatoshiAmount(-100);
    expect(resNeg.isValid).toBe(false);
    expect(resNeg.error).toMatch(/strictly positive/i);

    expect(MicroPaymentEngine.isValidSatoshiAmount(0)).toBe(false);
    expect(MicroPaymentEngine.isValidSatoshiAmount(-50)).toBe(false);
  });

  it("rejects fractional and decimal satoshi amounts", () => {
    const resDecimal = MicroPaymentEngine.validateSatoshiAmount(12.34);
    expect(resDecimal.isValid).toBe(false);
    expect(resDecimal.error).toMatch(/decimal|integer/i);

    const resNegDecimal = MicroPaymentEngine.validateSatoshiAmount(-0.5);
    expect(resNegDecimal.isValid).toBe(false);
    expect(resNegDecimal.error).toMatch(/strictly positive/i);

    expect(MicroPaymentEngine.isValidSatoshiAmount(10.5)).toBe(false);
  });

  it("rejects malformed non-numeric values, NaN, and null/undefined", () => {
    expect(MicroPaymentEngine.validateSatoshiAmount("abc").isValid).toBe(false);
    expect(MicroPaymentEngine.validateSatoshiAmount(NaN).isValid).toBe(false);
    expect(MicroPaymentEngine.validateSatoshiAmount(Infinity).isValid).toBe(false);
    expect(MicroPaymentEngine.validateSatoshiAmount(null).isValid).toBe(false);
    expect(MicroPaymentEngine.validateSatoshiAmount(undefined).isValid).toBe(false);
  });

  it("throws error in createMicroInvoice when customSats <= 0 or decimal for lightning rail", () => {
    expect(() => {
      MicroPaymentEngine.createMicroInvoice("sess-test", 1.0, "lightning", -50);
    }).toThrow(/strictly positive/i);

    expect(() => {
      MicroPaymentEngine.createMicroInvoice("sess-test", 1.0, "lightning", 0);
    }).toThrow(/strictly positive/i);

    expect(() => {
      MicroPaymentEngine.createMicroInvoice("sess-test", 1.0, "lightning", 12.5);
    }).toThrow(/integer|decimal/i);
  });

  it("throws error in createMicroInvoice when amountUsd <= 0 for lightning rail", () => {
    expect(() => {
      MicroPaymentEngine.createMicroInvoice("sess-test", -5.0, "lightning");
    }).toThrow(/strictly positive/i);

    expect(() => {
      MicroPaymentEngine.createMicroInvoice("sess-test", 0, "lightning");
    }).toThrow(/strictly positive/i);
  });
});

describe("POST /api/payments/micropay/session - Negative & Malformed Satoshi Rejection (#5274)", () => {
  it("rejects negative satoshiAmount with 400 Bad Request", async () => {
    const req = createMockPostRequest({
      action: "invoice",
      paymentRail: "lightning",
      satoshiAmount: -500,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toMatch(/strictly positive/i);
  });

  it("rejects zero satoshiAmount with 400 Bad Request", async () => {
    const req = createMockPostRequest({
      action: "invoice",
      paymentRail: "lightning",
      satoshiAmount: 0,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toMatch(/strictly positive/i);
  });

  it("rejects negative decimal satoshi amounts with 400 Bad Request", async () => {
    const req = createMockPostRequest({
      action: "invoice",
      paymentRail: "lightning",
      satoshiAmount: -0.75,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toMatch(/strictly positive/i);
  });

  it("rejects decimal satoshi numbers with 400 Bad Request", async () => {
    const req = createMockPostRequest({
      action: "invoice",
      paymentRail: "lightning",
      satoshiAmount: 1450.5,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toMatch(/decimal|integer/i);
  });

  it("rejects malformed satoshi string inputs with 400 Bad Request", async () => {
    const req = createMockPostRequest({
      action: "invoice",
      paymentRail: "lightning",
      satoshiAmount: "invalid-sats",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toMatch(/numeric|valid/i);
  });

  it("rejects negative sats/amountSats aliases with 400 Bad Request", async () => {
    const req1 = createMockPostRequest({
      action: "invoice",
      paymentRail: "lightning",
      sats: -100,
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(400);

    const req2 = createMockPostRequest({
      action: "invoice",
      paymentRail: "lightning",
      amountSats: -250,
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(400);
  });

  it("rejects negative satoshi amount in action 'start' with 400 Bad Request", async () => {
    const req = createMockPostRequest({
      action: "start",
      paymentRail: "lightning",
      satoshiAmount: -1000,
      generateInvoice: true,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toMatch(/strictly positive/i);
  });

  it("accepts strictly positive integer satoshi amount and generates Lightning invoice", async () => {
    const req = createMockPostRequest({
      action: "invoice",
      paymentRail: "lightning",
      satoshiAmount: 2500,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.invoice).toBeDefined();
    expect(data.invoice.paymentRail).toBe("lightning");
    expect(data.invoice.amountCrypto).toBe("2,500 Sats");
    expect(data.invoice.cryptoAddressOrInvoice).toMatch(/^lnbc2500/);
    expect(data.invoice.qrPayload).toMatch(/^lightning:lnbc2500/);
  });

  it("successfully starts a valid session without negative amounts", async () => {
    const req = createMockPostRequest({
      action: "start",
      deskId: "desk-test-01",
      paymentRail: "lightning",
      hourlyRateUsd: 5.0,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.session.deskId).toBe("desk-test-01");
    expect(data.session.status).toBe("active");
  });
});
