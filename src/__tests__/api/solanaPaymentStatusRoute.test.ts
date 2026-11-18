import { NextRequest } from "next/server";
import {
  GET,
  POST,
} from "@/app/api/payments/solana/status/route";
import { SOLANA_PAY_DEFAULT_TIMEOUT_MS } from "@/lib/payments/solanaPay";

describe("/api/payments/solana/status route security & simulation hardening (#6679)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("Validation & Missing Parameters", () => {
    it("returns 400 when reference query parameter is missing in GET", async () => {
      const req = new NextRequest("http://localhost:3000/api/payments/solana/status");
      const res = await GET(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Missing required 'reference' query parameter");
    });

    it("returns 400 when reference is missing in POST body", async () => {
      const req = new NextRequest("http://localhost:3000/api/payments/solana/status", {
        method: "POST",
        body: JSON.stringify({ action: "confirm" }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Missing 'reference' field");
    });

    it("returns 400 when action is invalid in POST body", async () => {
      const req = new NextRequest("http://localhost:3000/api/payments/solana/status", {
        method: "POST",
        body: JSON.stringify({ reference: "tx_ref_123", action: "unsupported_action" }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid action");
    });
  });

  describe("Production Environment Enforcement (NODE_ENV=production)", () => {
    beforeEach(() => {
      (process.env as any).NODE_ENV = "production";
    });

    it("rejects GET simulate=true even when simulation flag is true", async () => {
      process.env.ENABLE_SOLANA_PAYMENT_SIMULATION = "true";

      const req = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_prod_1&simulate=true"
      );
      const res = await GET(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Payment simulation is disabled in production");
    });

    it("rejects GET simulate=true when simulation flag is false or unset", async () => {
      process.env.ENABLE_SOLANA_PAYMENT_SIMULATION = "false";

      const req1 = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_prod_2&simulate=true"
      );
      const res1 = await GET(req1);
      expect(res1.status).toBe(400);
      const data1 = await res1.json();
      expect(data1.error).toBe("Payment simulation is disabled in production");

      delete process.env.ENABLE_SOLANA_PAYMENT_SIMULATION;
      const req2 = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_prod_3&simulate=true"
      );
      const res2 = await GET(req2);
      expect(res2.status).toBe(400);
      const data2 = await res2.json();
      expect(data2.error).toBe("Payment simulation is disabled in production");
    });

    it("rejects GET expired=true simulation in production", async () => {
      process.env.ENABLE_SOLANA_PAYMENT_SIMULATION = "true";

      const req = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_prod_4&expired=true"
      );
      const res = await GET(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Payment simulation is disabled in production");
    });

    it("rejects POST action: confirm in production even when flag is true", async () => {
      process.env.ENABLE_SOLANA_PAYMENT_SIMULATION = "true";

      const req = new NextRequest("http://localhost:3000/api/payments/solana/status", {
        method: "POST",
        body: JSON.stringify({ reference: "tx_prod_5", action: "confirm" }),
      });
      const res = await POST(req);

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Manual payment actions are forbidden in production");
    });

    it("rejects POST action: expire in production even when flag is true", async () => {
      process.env.ENABLE_SOLANA_PAYMENT_SIMULATION = "true";

      const req = new NextRequest("http://localhost:3000/api/payments/solana/status", {
        method: "POST",
        body: JSON.stringify({ reference: "tx_prod_6", action: "expire" }),
      });
      const res = await POST(req);

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Manual payment actions are forbidden in production");
    });

    it("returns fail-closed PENDING status for new references without synthetic signatures or slots", async () => {
      delete process.env.ENABLE_SOLANA_PAYMENT_SIMULATION;

      const req = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_prod_safe_1"
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.reference).toBe("tx_prod_safe_1");
      expect(data.status).toBe("PENDING");
      expect(data.signature).toBeUndefined();
      expect(data.slot).toBeUndefined();
      expect(data.createdAt).toBeDefined();
    });

    it("never emits CONFIRMED in production even if an in-memory entry had CONFIRMED status", async () => {
      const uniqueRef = "tx_leak_confirmed_test";

      // 1. With NODE_ENV=development and ENABLE_SOLANA_PAYMENT_SIMULATION=true, simulate CONFIRMED for unique reference
      (process.env as any).NODE_ENV = "development";
      process.env.ENABLE_SOLANA_PAYMENT_SIMULATION = "true";

      const devReq = new NextRequest(
        `http://localhost:3000/api/payments/solana/status?reference=${uniqueRef}&simulate=true`
      );
      const devRes = await GET(devReq);
      expect(devRes.status).toBe(200);
      const devData = await devRes.json();
      expect(devData.status).toBe("CONFIRMED");

      // 2. Switch NODE_ENV to production
      (process.env as any).NODE_ENV = "production";

      // 3. Query the same reference in production
      const prodReq = new NextRequest(
        `http://localhost:3000/api/payments/solana/status?reference=${uniqueRef}`
      );
      const prodRes = await GET(prodReq);

      // 4. Assert response is PENDING and contains no signature or slot
      expect(prodRes.status).toBe(200);
      const prodData = await prodRes.json();
      expect(prodData.reference).toBe(uniqueRef);
      expect(prodData.status).toBe("PENDING");
      expect(prodData.signature).toBeUndefined();
      expect(prodData.slot).toBeUndefined();
    });
  });

  describe("Non-Production Environment Simulation Gating", () => {
    beforeEach(() => {
      (process.env as any).NODE_ENV = "development";
    });

    it("rejects simulation when ENABLE_SOLANA_PAYMENT_SIMULATION is missing or false", async () => {
      delete process.env.ENABLE_SOLANA_PAYMENT_SIMULATION;

      const reqGet = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_dev_1&simulate=true"
      );
      const resGet = await GET(reqGet);
      expect(resGet.status).toBe(400);
      const dataGet = await resGet.json();
      expect(dataGet.error).toContain("ENABLE_SOLANA_PAYMENT_SIMULATION=true");

      process.env.ENABLE_SOLANA_PAYMENT_SIMULATION = "false";
      const reqPost = new NextRequest("http://localhost:3000/api/payments/solana/status", {
        method: "POST",
        body: JSON.stringify({ reference: "tx_dev_2", action: "confirm" }),
      });
      const resPost = await POST(reqPost);
      expect(resPost.status).toBe(403);
      const dataPost = await resPost.json();
      expect(dataPost.error).toContain("ENABLE_SOLANA_PAYMENT_SIMULATION=true");
    });

    it("allows simulation only when both NODE_ENV !== 'production' and ENABLE_SOLANA_PAYMENT_SIMULATION === 'true'", async () => {
      process.env.ENABLE_SOLANA_PAYMENT_SIMULATION = "true";

      const reqGet = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_dev_3&simulate=true"
      );
      const resGet = await GET(reqGet);
      expect(resGet.status).toBe(200);
      const dataGet = await resGet.json();
      expect(dataGet.status).toBe("CONFIRMED");
      expect(dataGet.signature).toMatch(/^5K2x/);
      expect(dataGet.slot).toBe(248901234);

      const reqPost = new NextRequest("http://localhost:3000/api/payments/solana/status", {
        method: "POST",
        body: JSON.stringify({ reference: "tx_dev_4", action: "confirm" }),
      });
      const resPost = await POST(reqPost);
      expect(resPost.status).toBe(200);
      const dataPost = await resPost.json();
      expect(dataPost.status).toBe("CONFIRMED");
      expect(dataPost.signature).toMatch(/^5K2x/);
    });

    it("allows simulated expiration when opt-in flag is true in development", async () => {
      process.env.ENABLE_SOLANA_PAYMENT_SIMULATION = "true";

      const reqGet = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_dev_5&expired=true"
      );
      const resGet = await GET(reqGet);
      expect(resGet.status).toBe(200);
      const dataGet = await resGet.json();
      expect(dataGet.status).toBe("EXPIRED");
      expect(dataGet.message).toContain("Transaction expired");

      const reqPost = new NextRequest("http://localhost:3000/api/payments/solana/status", {
        method: "POST",
        body: JSON.stringify({ reference: "tx_dev_6", action: "expire" }),
      });
      const resPost = await POST(reqPost);
      expect(resPost.status).toBe(200);
      const dataPost = await resPost.json();
      expect(dataPost.status).toBe("EXPIRED");
    });
  });

  describe("Trusted TTL Expiration Behavior", () => {
    it("transitions pending payment to EXPIRED when blockhash TTL (5 mins) is exceeded", async () => {
      delete process.env.ENABLE_SOLANA_PAYMENT_SIMULATION;
      (process.env as any).NODE_ENV = "production";

      const initialTime = 1700000000000;
      jest.spyOn(Date, "now").mockReturnValue(initialTime);

      // First poll records createdAt
      const req1 = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_ttl_test"
      );
      const res1 = await GET(req1);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.status).toBe("PENDING");

      // Advance time beyond blockhash TTL (5 minutes + 1 second)
      jest.spyOn(Date, "now").mockReturnValue(initialTime + SOLANA_PAY_DEFAULT_TIMEOUT_MS + 1000);

      const req2 = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_ttl_test"
      );
      const res2 = await GET(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.status).toBe("EXPIRED");
      expect(data2.message).toBe("Transaction expired. Please generate a new QR code.");
    });

    it("restores Date.now spy via afterEach and initializes unpolled reference as PENDING", async () => {
      delete process.env.ENABLE_SOLANA_PAYMENT_SIMULATION;
      (process.env as any).NODE_ENV = "production";

      // If Date.now was not restored by afterEach, this would still be the mocked time
      const currentRealTime = Date.now();
      expect(currentRealTime).not.toBe(1700000000000 + SOLANA_PAY_DEFAULT_TIMEOUT_MS + 1000);

      const req = new NextRequest(
        "http://localhost:3000/api/payments/solana/status?reference=tx_brand_new"
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      // First observation initializes as PENDING, not EXPIRED
      expect(data.status).toBe("PENDING");
    });
  });
});
