/**
 * microBillingPersistence.ts
 *
 * Distributed, concurrency-safe, database-backed persistence layer for
 * pay-as-you-go micro-billing sessions (#8436).
 *
 * Replaces the process-local in-memory Map as the authoritative data source.
 * Ensures active micro-billing sessions survive process restarts and remain
 * consistent across multiple distributed application instances.
 */

import { prisma } from "@/lib/prisma";
import {
  MicroBillingSession,
  PaymentRail,
  LIVE_EXCHANGE_RATES,
  MicroPaymentEngine,
} from "./microPaymentEngine";
import {
  MicroBillingSessionRecord,
  MicroBillingSessionStatus,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Micro-billing session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConflictError";
  }
}

export class UnauthorizedSessionAccessError extends Error {
  constructor(
    message: string = "Unauthorized access to micro-billing session",
  ) {
    super(message);
    this.name = "UnauthorizedSessionAccessError";
  }
}

/**
 * Maps database enum status to MicroBillingSession status string
 */
export function mapDbStatusToDomain(
  dbStatus: MicroBillingSessionStatus,
): MicroBillingSession["status"] {
  switch (dbStatus) {
    case MicroBillingSessionStatus.ACTIVE:
      return "active";
    case MicroBillingSessionStatus.PAUSED:
      return "paused";
    case MicroBillingSessionStatus.SETTLED:
      return "settled";
    case MicroBillingSessionStatus.SETTLING:
      return "pending_payment";
    case MicroBillingSessionStatus.FAILED:
      return "paused";
    default:
      return "active";
  }
}

/**
 * Converts a database record into the standard domain MicroBillingSession object
 */
export function mapRecordToSession(
  record: MicroBillingSessionRecord,
): MicroBillingSession {
  return {
    sessionId: record.sessionId,
    deskId: record.deskId,
    deskName: record.deskName,
    venueName: record.venueName,
    userId: record.userId ?? undefined,
    paymentRail: record.paymentRail as PaymentRail,
    status: mapDbStatusToDomain(record.status),
    startTime: record.startTime.getTime(),
    lastHeartbeatTime: record.lastHeartbeatTime.getTime(),
    elapsedSeconds: record.elapsedSeconds,
    hourlyRateUsd: Number(record.hourlyRateUsd.toString()),
    totalAccruedUsd: Number(record.totalAccruedUsd.toString()),
    totalAccruedSats: Number(record.totalAccruedSats),
    totalAccruedUsdc: Number(record.totalAccruedUsdc.toString()),
    depositHoldUsd: Number(record.depositHoldUsd.toString()),
    paymentProofHash: record.paymentProofHash ?? undefined,
  };
}

export interface CreateSessionParams {
  sessionId: string;
  deskId: string;
  deskName: string;
  venueName: string;
  paymentRail: PaymentRail;
  hourlyRateUsd: number;
  userId?: string;
  depositHoldUsd?: number;
  idempotencyKey?: string;
}

export interface SettlementReceipt {
  proofHash: string;
  amountPaidUsd: number;
  amountPaidCrypto: string;
  rail: PaymentRail;
  settledAt: string;
}

export interface SettleSessionResult {
  session: MicroBillingSession;
  receipt: SettlementReceipt;
  alreadySettled: boolean;
}

export class MicroBillingPersistenceService {
  /**
   * Creates a new micro-billing session persisted in the database.
   * If an idempotencyKey is provided and an existing session matches, returns the existing session.
   */
  public static async createSession(
    params: CreateSessionParams,
  ): Promise<MicroBillingSession> {
    const now = new Date();

    if (params.idempotencyKey) {
      const existing = await prisma.microBillingSessionRecord.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existing) {
        return mapRecordToSession(existing);
      }
    }

    try {
      const created = await prisma.microBillingSessionRecord.create({
        data: {
          sessionId: params.sessionId,
          deskId: params.deskId,
          deskName: params.deskName,
          venueName: params.venueName,
          userId: params.userId ?? null,
          paymentRail: params.paymentRail,
          status: MicroBillingSessionStatus.ACTIVE,
          startTime: now,
          lastHeartbeatTime: now,
          elapsedSeconds: 0,
          hourlyRateUsd: new Prisma.Decimal(params.hourlyRateUsd.toFixed(4)),
          totalAccruedUsd: new Prisma.Decimal(0),
          totalAccruedSats: BigInt(0),
          totalAccruedUsdc: new Prisma.Decimal(0),
          depositHoldUsd: new Prisma.Decimal(
            (params.depositHoldUsd ?? 10.0).toFixed(4),
          ),
          idempotencyKey: params.idempotencyKey ?? null,
        },
      });

      return mapRecordToSession(created);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Unique constraint violation (e.g., duplicate sessionId or idempotencyKey)
        const existing = await prisma.microBillingSessionRecord.findUnique({
          where: { sessionId: params.sessionId },
        });
        if (existing) {
          return mapRecordToSession(existing);
        }
      }
      throw err;
    }
  }

  /**
   * Retrieves a session from shared persistent storage.
   * Optionally validates that requestingUserId matches session.userId if present.
   */
  public static async getSession(
    sessionId: string,
    requestingUserId?: string,
  ): Promise<MicroBillingSession> {
    const record = await prisma.microBillingSessionRecord.findUnique({
      where: { sessionId },
    });

    if (!record) {
      throw new SessionNotFoundError(sessionId);
    }

    if (
      record.userId &&
      requestingUserId &&
      record.userId !== requestingUserId
    ) {
      throw new UnauthorizedSessionAccessError();
    }

    return mapRecordToSession(record);
  }

  /**
   * Atomically ticks an active session forward to the given timestamp.
   * If the session is already SETTLED or PAUSED, returns the current state without accumulating new charges.
   * Uses conditional update (optimistic concurrency) to guarantee that concurrent ticks
   * or stale timestamps cannot overwrite or corrupt accrued amounts.
   */
  public static async tickSessionAtomic(
    sessionId: string,
    nowTimestamp: number = Date.now(),
    requestingUserId?: string,
  ): Promise<MicroBillingSession> {
    const record = await prisma.microBillingSessionRecord.findUnique({
      where: { sessionId },
    });

    if (!record) {
      throw new SessionNotFoundError(sessionId);
    }

    if (
      record.userId &&
      requestingUserId &&
      record.userId !== requestingUserId
    ) {
      throw new UnauthorizedSessionAccessError();
    }

    // Terminal or non-active states do not accumulate further charges
    if (record.status !== MicroBillingSessionStatus.ACTIVE) {
      return mapRecordToSession(record);
    }

    const startMs = record.startTime.getTime();
    // Prevent stale or backwards time
    const effectiveNow = Math.max(
      nowTimestamp,
      record.lastHeartbeatTime.getTime(),
    );
    const elapsedSeconds = Math.max(
      0,
      Math.floor((effectiveNow - startMs) / 1000),
    );
    const elapsedMinutes = elapsedSeconds / 60;
    const hourlyRate = Number(record.hourlyRateUsd.toString());
    const ratePerMinuteUsd = hourlyRate / 60;

    const totalAccruedUsd = Number(
      (elapsedMinutes * ratePerMinuteUsd).toFixed(4),
    );
    const totalAccruedSats = Math.ceil(
      totalAccruedUsd * LIVE_EXCHANGE_RATES.satsPerUsd,
    );
    const totalAccruedUsdc = totalAccruedUsd;

    const newHeartbeat = new Date(effectiveNow);

    // Atomic conditional update ensuring status is still ACTIVE and timestamp hasn't moved past ours
    await prisma.microBillingSessionRecord.updateMany({
      where: {
        sessionId,
        status: MicroBillingSessionStatus.ACTIVE,
        lastHeartbeatTime: { lte: newHeartbeat },
      },
      data: {
        lastHeartbeatTime: newHeartbeat,
        elapsedSeconds,
        totalAccruedUsd: new Prisma.Decimal(totalAccruedUsd.toFixed(4)),
        totalAccruedSats: BigInt(totalAccruedSats),
        totalAccruedUsdc: new Prisma.Decimal(totalAccruedUsdc.toFixed(4)),
      },
    });

    // If update affected 0 rows (e.g. concurrent tick or status transition), re-read fresh state
    const fresh = await prisma.microBillingSessionRecord.findUnique({
      where: { sessionId },
    });

    if (!fresh) {
      throw new SessionNotFoundError(sessionId);
    }

    return mapRecordToSession(fresh);
  }

  /**
   * Atomically settles a micro-billing session.
   *
   * Concurrency-safety and Idempotency guarantees:
   * 1. If already SETTLED, idempotently returns the committed settlement state & receipt.
   * 2. Uses an atomic conditional transition: ACTIVE -> SETTLED in a single updateMany operation.
   *    If multiple concurrent settlement requests arrive, exactly ONE will update count = 1.
   * 3. Settlement amount is frozen to the final tick calculation at transition time.
   * 4. The receipt proof hash is persisted durably and returned deterministically on all calls.
   */
  public static async settleSessionAtomic(
    sessionId: string,
    options: {
      requestingUserId?: string;
      customSats?: number;
      settleTimestamp?: number;
    } = {},
  ): Promise<SettleSessionResult> {
    const existing = await prisma.microBillingSessionRecord.findUnique({
      where: { sessionId },
    });

    if (!existing) {
      throw new SessionNotFoundError(sessionId);
    }

    if (
      existing.userId &&
      options.requestingUserId &&
      existing.userId !== options.requestingUserId
    ) {
      throw new UnauthorizedSessionAccessError();
    }

    // Idempotent return if already settled
    if (existing.status === MicroBillingSessionStatus.SETTLED) {
      const session = mapRecordToSession(existing);
      const settledAtStr = existing.settledAt
        ? existing.settledAt.toISOString()
        : existing.updatedAt.toISOString();

      return {
        session,
        receipt: {
          proofHash: existing.paymentProofHash || "",
          amountPaidUsd: session.totalAccruedUsd,
          amountPaidCrypto:
            session.paymentRail === "lightning"
              ? `${session.totalAccruedSats} Sats`
              : `${session.totalAccruedUsdc} USDC`,
          rail: session.paymentRail,
          settledAt: settledAtStr,
        },
        alreadySettled: true,
      };
    }

    const effectiveTime = options.settleTimestamp ?? Date.now();
    const startMs = existing.startTime.getTime();
    const elapsedSeconds = Math.max(
      0,
      Math.floor((effectiveTime - startMs) / 1000),
    );
    const elapsedMinutes = elapsedSeconds / 60;
    const hourlyRate = Number(existing.hourlyRateUsd.toString());
    const ratePerMinuteUsd = hourlyRate / 60;

    const finalAccruedUsd = Number(
      (elapsedMinutes * ratePerMinuteUsd).toFixed(4),
    );
    const finalAccruedSats = Math.ceil(
      finalAccruedUsd * LIVE_EXCHANGE_RATES.satsPerUsd,
    );
    const finalAccruedUsdc = finalAccruedUsd;

    if (existing.paymentRail === "lightning" && finalAccruedSats < 1) {
      throw new Error(
        "Invalid settlement amount: Satoshi amount must be at least 1 Satoshi.",
      );
    }

    const paymentProofHash = MicroPaymentEngine.generatePaymentReceiptHash(
      sessionId,
      existing.paymentRail as PaymentRail,
      finalAccruedUsd,
    );

    const settledAt = new Date(effectiveTime);

    // Atomic conditional update: only transitions if status is currently ACTIVE
    const result = await prisma.microBillingSessionRecord.updateMany({
      where: {
        sessionId,
        status: MicroBillingSessionStatus.ACTIVE,
      },
      data: {
        status: MicroBillingSessionStatus.SETTLED,
        lastHeartbeatTime: settledAt,
        elapsedSeconds,
        totalAccruedUsd: new Prisma.Decimal(finalAccruedUsd.toFixed(4)),
        totalAccruedSats: BigInt(finalAccruedSats),
        totalAccruedUsdc: new Prisma.Decimal(finalAccruedUsdc.toFixed(4)),
        paymentProofHash,
        settledAt,
      },
    });

    // Re-fetch the definitive committed record
    const updated = await prisma.microBillingSessionRecord.findUnique({
      where: { sessionId },
    });

    if (!updated) {
      throw new SessionNotFoundError(sessionId);
    }

    const session = mapRecordToSession(updated);
    const settledAtStr = updated.settledAt
      ? updated.settledAt.toISOString()
      : updated.updatedAt.toISOString();

    const receipt: SettlementReceipt = {
      proofHash: updated.paymentProofHash || paymentProofHash,
      amountPaidUsd: session.totalAccruedUsd,
      amountPaidCrypto:
        session.paymentRail === "lightning"
          ? `${session.totalAccruedSats} Sats`
          : `${session.totalAccruedUsdc} USDC`,
      rail: session.paymentRail,
      settledAt: settledAtStr,
    };

    return {
      session,
      receipt,
      alreadySettled:
        result.count === 0 &&
        updated.status === MicroBillingSessionStatus.SETTLED,
    };
  }
}
