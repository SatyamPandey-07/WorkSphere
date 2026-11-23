import { POST } from "@/app/api/webhooks/payment/route";
import { computeHmacSignature } from "@/lib/security/hmac";

describe("POST /api/webhooks/payment", () => {
  const secret = "test-payment-webhook-secret";
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, PAYMENT_WEBHOOK_SECRET: secret };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 500 when webhook secret is not configured", async () => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    delete process.env.WEBHOOK_SECRET;

    const req = new Request("http://localhost/api/webhooks/payment", {
      method: "POST",
      body: JSON.stringify({ event: "charge.succeeded" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Webhook secret not configured");
  });

  it("returns 401 when signature header is missing", async () => {
    const req = new Request("http://localhost/api/webhooks/payment", {
      method: "POST",
      body: JSON.stringify({ event: "charge.succeeded" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Missing signature header");
  });

  it("returns 401 when signature is invalid or tampered", async () => {
    const body = JSON.stringify({ event: "charge.succeeded", id: "evt_123" });
    const req = new Request("http://localhost/api/webhooks/payment", {
      method: "POST",
      headers: {
        "x-worksphere-signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Invalid webhook signature");
  });

  it("returns 200 when signature is valid", async () => {
    const body = JSON.stringify({ event: "charge.succeeded", id: "evt_123" });
    const sig = computeHmacSignature(body, secret);

    const req = new Request("http://localhost/api/webhooks/payment", {
      method: "POST",
      headers: {
        "x-worksphere-signature": `sha256=${sig}`,
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      received: true,
      eventId: "evt_123",
      status: "processed",
    });
  });
});
