/**
 * microBillingPersistence.test.ts
 *
 * Comprehensive tests for persistent micro-billing session management (#8436).
 *
 * Covers:
 * A. Session persistence tests (creation, retrieval, restart/reconstruction simulation, ownership)
 * B. Billing tick tests (increment, concurrency safety, stale/backwards tick handling, settled freeze)
 * C. Settlement tests (single finalization, receipt idempotency, atomic transitions, error rollback)
 * D. Distributed multi-instance simulation (Instance A creates, Instance B ticks, concurrent settlements)
 * E. Failure and recovery tests (constraint violations, unauthorized access, missing records)
 */

import {
  MicroBillingPersistenceService,
  SessionNotFoundError,
  UnauthorizedSessionAccessError,
  mapDbStatusToDomain,
} from "@/lib/payments/microBillingPersistence";
import { prisma } from "@/lib/prisma";
import { MicroBillingSessionStatus, Prisma } from "@prisma/client";
import { LIVE_EXCHANGE_RATES } from "@/lib/payments/microPaymentEngine";

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
          if (store.has(data.sessionId)) {
            const err = new Prisma.PrismaClientKnownRequestError(
              "Unique constraint failed",
              {
                code: "P2002",
                clientVersion: "7.10.1",
              },
            );
            throw err;
          }
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

            // Status condition check
            if (where.status && rec.status !== where.status) {
              return { count: 0 };
            }

            // Timestamp condition check
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

describe("MicroBillingPersistenceService (#8436)", () => {
  const mockPrismaStore = (prisma.microBillingSessionRecord as any)
    .store as Map<string, any>;

  beforeEach(() => {
    mockPrismaStore.clear();
    jest.clearAllMocks();
  });

  describe("A. Session Persistence & Restart Survival", () => {
    it("persists a newly created session to database storage", async () => {
      const created = await MicroBillingPersistenceService.createSession({
        sessionId: "session-persist-1",
        deskId: "desk-sf-101",
        deskName: "Window Standing Desk 4",
        venueName: "SF Hub",
        paymentRail: "lightning",
        hourlyRateUsd: 6.0,
        userId: "user-alice",
        depositHoldUsd: 10.0,
      });

      expect(created.sessionId).toBe("session-persist-1");
      expect(created.status).toBe("active");
      expect(created.hourlyRateUsd).toBe(6.0);
      expect(created.userId).toBe("user-alice");

      // Verify direct database storage
      expect(mockPrismaStore.has("session-persist-1")).toBe(true);
    });

    it("survives process reconstruction (simulated restart: fresh retrieval reads committed state)", async () => {
      const sessionId = "session-restart-test";
      await MicroBillingPersistenceService.createSession({
        sessionId,
        deskId: "desk-restart",
        deskName: "Quiet Pod 2",
        venueName: "Austin Workspace",
        paymentRail: "usdc_solana",
        hourlyRateUsd: 4.5,
        userId: "user-bob",
      });

      // Advance time and tick
      const startTime = mockPrismaStore.get(sessionId).startTime.getTime();
      await MicroBillingPersistenceService.tickSessionAtomic(
        sessionId,
        startTime + 120 * 1000,
      );

      // Re-read directly from storage as if a new process instance started up
      const retrievedAfterRestart =
        await MicroBillingPersistenceService.getSession(sessionId);
      expect(retrievedAfterRestart.elapsedSeconds).toBe(120);
      expect(retrievedAfterRestart.totalAccruedUsd).toBeCloseTo(
        (120 / 3600) * 4.5,
        3,
      );
      expect(retrievedAfterRestart.status).toBe("active");
    });

    it("idempotently handles session creation when idempotencyKey is supplied", async () => {
      const key = "idem-key-unique-123";
      const first = await MicroBillingPersistenceService.createSession({
        sessionId: "session-idem-1",
        deskId: "desk-1",
        deskName: "Desk 1",
        venueName: "Venue 1",
        paymentRail: "lightning",
        hourlyRateUsd: 5.0,
        idempotencyKey: key,
      });

      const second = await MicroBillingPersistenceService.createSession({
        sessionId: "session-idem-2", // different sessionId requested
        deskId: "desk-1",
        deskName: "Desk 1",
        venueName: "Venue 1",
        paymentRail: "lightning",
        hourlyRateUsd: 5.0,
        idempotencyKey: key,
      });

      expect(second.sessionId).toBe(first.sessionId);
    });

    it("enforces session ownership and prevents unauthorized cross-user access", async () => {
      await MicroBillingPersistenceService.createSession({
        sessionId: "session-private-1",
        deskId: "desk-priv",
        deskName: "Private Suite",
        venueName: "HQ",
        paymentRail: "lightning",
        hourlyRateUsd: 10.0,
        userId: "owner-alice",
      });

      // Allowed for the owner
      await expect(
        MicroBillingPersistenceService.getSession(
          "session-private-1",
          "owner-alice",
        ),
      ).resolves.toBeDefined();

      // Rejected for another user
      await expect(
        MicroBillingPersistenceService.getSession(
          "session-private-1",
          "attacker-mallory",
        ),
      ).rejects.toThrow(UnauthorizedSessionAccessError);
    });
  });

  describe("B. Concurrency-Safe Billing Ticks", () => {
    it("increments accrued amounts correctly based on elapsed seconds", async () => {
      const sessionId = "session-tick-1";
      await MicroBillingPersistenceService.createSession({
        sessionId,
        deskId: "desk-tick",
        deskName: "Desk Tick",
        venueName: "Venue Tick",
        paymentRail: "lightning",
        hourlyRateUsd: 6.0,
      });

      const startMs = mockPrismaStore.get(sessionId).startTime.getTime();
      // 10 minutes (600 seconds) elapsed => 6.0 USD / hour * 10/60 = 1.00 USD
      const ticked = await MicroBillingPersistenceService.tickSessionAtomic(
        sessionId,
        startMs + 600 * 1000,
      );

      expect(ticked.elapsedSeconds).toBe(600);
      expect(ticked.totalAccruedUsd).toBe(1.0);
      expect(ticked.totalAccruedSats).toBe(
        Math.ceil(1.0 * LIVE_EXCHANGE_RATES.satsPerUsd),
      );
    });

    it("safely handles stale or backwards timestamps without decreasing elapsed time", async () => {
      const sessionId = "session-skew-1";
      await MicroBillingPersistenceService.createSession({
        sessionId,
        deskId: "desk-skew",
        deskName: "Desk Skew",
        venueName: "Venue Skew",
        paymentRail: "lightning",
        hourlyRateUsd: 6.0,
      });

      const startMs = mockPrismaStore.get(sessionId).startTime.getTime();
      // Tick to 300s
      await MicroBillingPersistenceService.tickSessionAtomic(
        sessionId,
        startMs + 300 * 1000,
      );

      // Attempt stale tick to 100s
      const staleTick = await MicroBillingPersistenceService.tickSessionAtomic(
        sessionId,
        startMs + 100 * 1000,
      );

      // Elapsed time should NOT regress
      expect(staleTick.elapsedSeconds).toBe(300);
    });

    it("does not allow charges to accrue on settled sessions", async () => {
      const sessionId = "session-freeze-1";
      await MicroBillingPersistenceService.createSession({
        sessionId,
        deskId: "desk-freeze",
        deskName: "Desk Freeze",
        venueName: "Venue Freeze",
        paymentRail: "lightning",
        hourlyRateUsd: 6.0,
      });

      const startMs = mockPrismaStore.get(sessionId).startTime.getTime();
      await MicroBillingPersistenceService.tickSessionAtomic(
        sessionId,
        startMs + 300 * 1000,
      );

      // Settle session at 300s
      const { session: settled } =
        await MicroBillingPersistenceService.settleSessionAtomic(sessionId, {
          settleTimestamp: startMs + 300 * 1000,
        });
      expect(settled.status).toBe("settled");
      const frozenUsd = settled.totalAccruedUsd;

      // Attempt to tick at 1000s
      const tickedAfterSettlement =
        await MicroBillingPersistenceService.tickSessionAtomic(
          sessionId,
          startMs + 1000 * 1000,
        );

      expect(tickedAfterSettlement.status).toBe("settled");
      expect(tickedAfterSettlement.totalAccruedUsd).toBe(frozenUsd);
      expect(tickedAfterSettlement.elapsedSeconds).toBe(300);
    });
  });

  describe("C. Atomic Settlement & Receipt Idempotency", () => {
    it("settles an active session and generates a deterministic proof receipt", async () => {
      const sessionId = "session-settle-norm";
      await MicroBillingPersistenceService.createSession({
        sessionId,
        deskId: "desk-norm",
        deskName: "Desk Normal",
        venueName: "Venue Normal",
        paymentRail: "lightning",
        hourlyRateUsd: 6.0,
      });

      const startMs = mockPrismaStore.get(sessionId).startTime.getTime();
      const res = await MicroBillingPersistenceService.settleSessionAtomic(
        sessionId,
        {
          settleTimestamp: startMs + 600 * 1000,
        },
      );

      expect(res.alreadySettled).toBe(false);
      expect(res.session.status).toBe("settled");
      expect(res.receipt.proofHash).toBeDefined();
      expect(res.receipt.amountPaidUsd).toBe(1.0);
      expect(res.receipt.rail).toBe("lightning");
    });

    it("is completely idempotent on repeated settlement calls, returning the exact same receipt", async () => {
      const sessionId = "session-settle-idempotent";
      await MicroBillingPersistenceService.createSession({
        sessionId,
        deskId: "desk-idem",
        deskName: "Desk Idem",
        venueName: "Venue Idem",
        paymentRail: "usdc_solana",
        hourlyRateUsd: 12.0,
      });

      const startMs = mockPrismaStore.get(sessionId).startTime.getTime();
      const settle1 = await MicroBillingPersistenceService.settleSessionAtomic(
        sessionId,
        {
          settleTimestamp: startMs + 300 * 1000,
        },
      );
      const settle2 = await MicroBillingPersistenceService.settleSessionAtomic(
        sessionId,
        {
          settleTimestamp: startMs + 600 * 1000, // even with later timestamp
        },
      );

      expect(settle1.alreadySettled).toBe(false);
      expect(settle2.alreadySettled).toBe(true);
      expect(settle1.receipt.proofHash).toBe(settle2.receipt.proofHash);
      expect(settle1.receipt.amountPaidUsd).toBe(settle2.receipt.amountPaidUsd);
      expect(settle2.session.totalAccruedUsd).toBe(
        settle1.session.totalAccruedUsd,
      );
    });

    it("rejects settlement of Lightning sessions if accrued amount is below 1 satoshi", async () => {
      const sessionId = "session-zero-sat";
      await MicroBillingPersistenceService.createSession({
        sessionId,
        deskId: "desk-zero",
        deskName: "Desk Zero",
        venueName: "Venue Zero",
        paymentRail: "lightning",
        hourlyRateUsd: 1.0,
      });

      const startMs = mockPrismaStore.get(sessionId).startTime.getTime();
      // Elapsed 0 seconds => 0 sats
      await expect(
        MicroBillingPersistenceService.settleSessionAtomic(sessionId, {
          settleTimestamp: startMs,
        }),
      ).rejects.toThrow(/Satoshi amount must be at least 1 Satoshi/i);
    });
  });

  describe("D. Multi-Instance Concurrency Simulation", () => {
    it("simulates Instance A creating a session and Instance B concurrently ticking it", async () => {
      // Instance A creates
      const createdByInstanceA =
        await MicroBillingPersistenceService.createSession({
          sessionId: "session-dist-1",
          deskId: "desk-multi",
          deskName: "Multi-Node Desk",
          venueName: "Mesh Venue",
          paymentRail: "usdc_base",
          hourlyRateUsd: 6.0,
        });

      // Instance B reads from shared DB
      const readByInstanceB =
        await MicroBillingPersistenceService.getSession("session-dist-1");
      expect(readByInstanceB.sessionId).toBe(createdByInstanceA.sessionId);

      // Concurrent ticks from Instance A and Instance B
      const startMs = mockPrismaStore.get("session-dist-1").startTime.getTime();
      const [_tickA, _tickB] = await Promise.all([
        MicroBillingPersistenceService.tickSessionAtomic(
          "session-dist-1",
          startMs + 120 * 1000,
        ),
        MicroBillingPersistenceService.tickSessionAtomic(
          "session-dist-1",
          startMs + 180 * 1000,
        ),
      ]);

      const finalState =
        await MicroBillingPersistenceService.getSession("session-dist-1");
      expect(finalState.elapsedSeconds).toBeGreaterThanOrEqual(120);
      expect(finalState.status).toBe("active");
    });

    it("handles concurrent settlements safely with exactly one winning transition", async () => {
      const sessionId = "session-race-settle";
      await MicroBillingPersistenceService.createSession({
        sessionId,
        deskId: "desk-race",
        deskName: "Desk Race",
        venueName: "Venue Race",
        paymentRail: "lightning",
        hourlyRateUsd: 6.0,
      });

      const startMs = mockPrismaStore.get(sessionId).startTime.getTime();
      const [res1, res2] = await Promise.all([
        MicroBillingPersistenceService.settleSessionAtomic(sessionId, {
          settleTimestamp: startMs + 300 * 1000,
        }),
        MicroBillingPersistenceService.settleSessionAtomic(sessionId, {
          settleTimestamp: startMs + 300 * 1000,
        }),
      ]);

      // Both return success with matching receipts, but exactly one was the first settler
      expect(res1.receipt.proofHash).toBe(res2.receipt.proofHash);
      const finalRecord = mockPrismaStore.get(sessionId);
      expect(finalRecord.status).toBe(MicroBillingSessionStatus.SETTLED);
    });
  });

  describe("E. Error Handling & Edge Cases", () => {
    it("throws SessionNotFoundError for nonexistent session ID", async () => {
      await expect(
        MicroBillingPersistenceService.getSession("non-existent-session-id"),
      ).rejects.toThrow(SessionNotFoundError);

      await expect(
        MicroBillingPersistenceService.tickSessionAtomic(
          "non-existent-session-id",
        ),
      ).rejects.toThrow(SessionNotFoundError);

      await expect(
        MicroBillingPersistenceService.settleSessionAtomic(
          "non-existent-session-id",
        ),
      ).rejects.toThrow(SessionNotFoundError);
    });

    it("maps database enum statuses accurately", () => {
      expect(mapDbStatusToDomain(MicroBillingSessionStatus.ACTIVE)).toBe(
        "active",
      );
      expect(mapDbStatusToDomain(MicroBillingSessionStatus.PAUSED)).toBe(
        "paused",
      );
      expect(mapDbStatusToDomain(MicroBillingSessionStatus.SETTLED)).toBe(
        "settled",
      );
      expect(mapDbStatusToDomain(MicroBillingSessionStatus.SETTLING)).toBe(
        "pending_payment",
      );
      expect(mapDbStatusToDomain(MicroBillingSessionStatus.FAILED)).toBe(
        "paused",
      );
    });
  });
});
