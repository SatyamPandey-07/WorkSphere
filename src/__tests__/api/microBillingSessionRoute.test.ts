/**
 * microBillingSessionRoute.test.ts
 *
 * Full API route tests for /api/payments/micropay/session with database persistence (#8436).
 * Tests GET and POST handlers, including start, invoice, settle, and retrieval workflows.
 */

import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/payments/micropay/session/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => {
  const store = new Map<string, any>();

  return {
    prisma: {
      microBillingSessionRecord: {
        store,
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: { sessionId?: string; idempotencyKey?: string };
          }) => {
            if (where.sessionId) {
              return store.get(where.sessionId) || null;
            }
            if (where.idempotencyKey) {
              for (const rec of store.values()) {
                if (rec.idempotencyKey === where.idempotencyKey) return rec;
              }
            }
            return null;
          },
        ),
        create: jest.fn(async ({ data }: { data: any }) => {
          const record = {
            id: `rec-${Math.random().toString(36).substring(2, 9)}`,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          store.set(data.sessionId, record);
          return record;
        }),
        updateMany: jest.fn(
          async ({ where, data }: { where: any; data: any }) => {
            const rec = store.get(where.sessionId);
            if (!rec) return { count: 0 };
            if (where.status && rec.status !== where.status)
              return { count: 0 };
            if (where.lastHeartbeatTime?.lte) {
              if (
                rec.lastHeartbeatTime.getTime() >
                where.lastHeartbeatTime.lte.getTime()
              ) {
                return { count: 0 };
              }
            }
            Object.assign(rec, data, { updatedAt: new Date() });
            store.set(where.sessionId, rec);
            return { count: 1 };
          },
        ),
      },
    },
  };
});

function createMockPostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/payments/micropay/session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function createMockGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/payments/micropay/session");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString(), { method: "GET" });
}

describe("POST & GET /api/payments/micropay/session Persistent Endpoints (#8436)", () => {
  const mockPrismaStore = (prisma.microBillingSessionRecord as any)
    .store as Map<string, any>;

  beforeEach(() => {
    mockPrismaStore.clear();
    jest.clearAllMocks();
  });

  it("creates and persists a session via POST action: start", async () => {
    const req = createMockPostRequest({
      action: "start",
      deskId: "desk-api-test",
      deskName: "Desk API Test",
      venueName: "Venue API Test",
      paymentRail: "lightning",
      hourlyRateUsd: 5.0,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.session).toBeDefined();
    expect(json.session.deskId).toBe("desk-api-test");
    expect(json.session.status).toBe("active");

    // Verify stored in DB
    expect(mockPrismaStore.has(json.session.sessionId)).toBe(true);
  });

  it("retrieves a persisted session via GET query parameter", async () => {
    // Start session first
    const startReq = createMockPostRequest({
      action: "start",
      deskId: "desk-api-query",
      hourlyRateUsd: 6.0,
    });
    const startRes = await POST(startReq);
    const { session } = await startRes.json();

    // Query session via GET
    const getReq = createMockGetRequest({ sessionId: session.sessionId });
    const getRes = await GET(getReq);
    expect(getRes.status).toBe(200);

    const getJson = await getRes.json();
    expect(getJson.success).toBe(true);
    expect(getJson.session.sessionId).toBe(session.sessionId);
    expect(getJson.session.status).toBe("active");
  });

  it("returns 404 for unknown sessionId in GET", async () => {
    const req = createMockGetRequest({ sessionId: "non-existent" });
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("settles a persisted session via POST action: settle and generates receipt", async () => {
    const startReq = createMockPostRequest({
      action: "start",
      deskId: "desk-to-settle",
      paymentRail: "usdc_base",
      hourlyRateUsd: 10.0,
    });
    const startRes = await POST(startReq);
    const { session } = await startRes.json();

    // Advance time slightly in the store
    const rec = mockPrismaStore.get(session.sessionId);
    rec.startTime = new Date(Date.now() - 300 * 1000); // 5 minutes ago

    const settleReq = createMockPostRequest({
      action: "settle",
      sessionId: session.sessionId,
    });
    const settleRes = await POST(settleReq);
    expect(settleRes.status).toBe(200);

    const settleJson = await settleRes.json();
    expect(settleJson.success).toBe(true);
    expect(settleJson.session.status).toBe("settled");
    expect(settleJson.receipt).toBeDefined();
    expect(settleJson.receipt.amountPaidUsd).toBeGreaterThan(0);
    expect(settleJson.receipt.rail).toBe("usdc_base");
  });

  it("returns 404 when settling a non-existent session", async () => {
    const req = createMockPostRequest({
      action: "settle",
      sessionId: "invalid-id",
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });
});
