import { createHash } from "crypto";

export type WebhookInboxStatus =
  | "PROCESSING"
  | "PROCESSED"
  | "IGNORED"
  | "FAILED"
  | "QUARANTINED";

export interface WebhookProcessingResult {
  action: string;
  userId?: string;
  reason?: string;
  eventType?: string;
}

export interface ClerkWebhookInboxRecord {
  svixId: string;
  eventType: string;
  subjectId?: string;
  eventTimestampMs: number;
  payloadHash: string;
  receivedAtMs: number;
  updatedAtMs: number;
  status: WebhookInboxStatus;
  attemptCount: number;
  lastError?: string;
  result?: WebhookProcessingResult;
}

export interface ClerkWebhookInboxOptions {
  /** Maximum attempts before a transient failure is quarantined for operator review. */
  maxAttempts?: number;
  /** Lease duration (ms) after which a PROCESSING record is eligible for reconciliation. */
  processingLeaseMs?: number;
  /** Maximum number of processed/tombstone entries retained in memory. */
  maxEntries?: number;
  /** Clock provider for deterministic testing. */
  nowFn?: () => number;
}

export function hashWebhookPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function extractClerkEventTimestampMs(
  data: Record<string, unknown>,
  svixTimestampHeader: string | null,
  nowMs: number = Date.now(),
): number {
  const updatedAt = data?.updated_at;
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = data?.created_at;
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
    return createdAt;
  }
  if (svixTimestampHeader) {
    const parsedSec = Number(svixTimestampHeader);
    if (Number.isFinite(parsedSec)) {
      return parsedSec * 1000;
    }
  }
  return nowMs;
}

export type ClaimDecision =
  | { kind: "CLAIMED"; record: ClerkWebhookInboxRecord }
  | { kind: "DUPLICATE"; record: ClerkWebhookInboxRecord }
  | { kind: "IN_FLIGHT"; record: ClerkWebhookInboxRecord }
  | { kind: "QUARANTINED"; record: ClerkWebhookInboxRecord };

/**
 * Transactional-semantics webhook inbox with Svix ID deduplication,
 * lifecycle tombstones, stale-update ordering guards, bounded retries,
 * and stuck-record reconciliation.
 */
export class ClerkWebhookInbox {
  private readonly records = new Map<string, ClerkWebhookInboxRecord>();
  private readonly deletedUserTombstones = new Map<string, number>();
  private readonly latestUserEventTimestamps = new Map<string, number>();
  private readonly maxAttempts: number;
  private readonly processingLeaseMs: number;
  private readonly maxEntries: number;
  private readonly nowFn: () => number;

  constructor(options: ClerkWebhookInboxOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.processingLeaseMs = options.processingLeaseMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.nowFn = options.nowFn ?? (() => Date.now());
  }

  /**
   * Claims a delivery for processing. Returns DUPLICATE if already completed
   * with the same payload hash, IN_FLIGHT if another worker holds an active
   * processing lease, or QUARANTINED if max retries were exceeded.
   */
  public claim(params: {
    svixId: string;
    eventType: string;
    subjectId?: string;
    eventTimestampMs: number;
    payloadHash: string;
    allowDifferentPayloadSameId?: boolean;
  }): ClaimDecision {
    const now = this.nowFn();
    const existing = this.records.get(params.svixId);

    if (existing) {
      const samePayload = existing.payloadHash === params.payloadHash;
      if (
        !samePayload &&
        params.allowDifferentPayloadSameId &&
        (existing.status === "PROCESSED" || existing.status === "IGNORED")
      ) {
        // Legacy test harnesses sometimes reuse a static svix-id across distinct
        // payloads; treat a different payloadHash as a fresh claim only when opted in.
      } else {
        if (existing.status === "PROCESSED" || existing.status === "IGNORED") {
          return { kind: "DUPLICATE", record: existing };
        }
        if (existing.status === "QUARANTINED") {
          return { kind: "QUARANTINED", record: existing };
        }
        if (
          existing.status === "PROCESSING" &&
          now - existing.updatedAtMs < this.processingLeaseMs
        ) {
          return { kind: "IN_FLIGHT", record: existing };
        }
        if (
          existing.status === "FAILED" &&
          existing.attemptCount >= this.maxAttempts
        ) {
          existing.status = "QUARANTINED";
          existing.updatedAtMs = now;
          return { kind: "QUARANTINED", record: existing };
        }
        existing.status = "PROCESSING";
        existing.attemptCount += 1;
        existing.updatedAtMs = now;
        return { kind: "CLAIMED", record: existing };
      }
    }

    if (this.records.size >= this.maxEntries) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey !== undefined) {
        this.records.delete(oldestKey);
      }
    }

    const record: ClerkWebhookInboxRecord = {
      svixId: params.svixId,
      eventType: params.eventType,
      subjectId: params.subjectId,
      eventTimestampMs: params.eventTimestampMs,
      payloadHash: params.payloadHash,
      receivedAtMs: now,
      updatedAtMs: now,
      status: "PROCESSING",
      attemptCount: 1,
    };
    this.records.set(params.svixId, record);
    return { kind: "CLAIMED", record };
  }

  public checkUserLifecycleOrder(params: {
    eventType: string;
    userId: string;
    eventTimestampMs: number;
  }): WebhookProcessingResult | null {
    const deletedAt = this.deletedUserTombstones.get(params.userId);
    if (deletedAt !== undefined && params.eventTimestampMs <= deletedAt) {
      return {
        action: "ignored",
        reason: "user_tombstoned",
        userId: params.userId,
      };
    }

    const lastEventTs = this.latestUserEventTimestamps.get(params.userId);
    if (
      params.eventType === "user.updated" &&
      lastEventTs !== undefined &&
      params.eventTimestampMs < lastEventTs
    ) {
      return {
        action: "ignored",
        reason: "stale_event",
        userId: params.userId,
      };
    }

    return null;
  }

  public recordUserUpsertCommitted(
    eventType: string,
    userId: string,
    eventTimestampMs: number,
  ): void {
    const prev = this.latestUserEventTimestamps.get(userId) ?? -Infinity;
    if (eventTimestampMs > prev) {
      this.latestUserEventTimestamps.set(userId, eventTimestampMs);
    }
    const deletedAt = this.deletedUserTombstones.get(userId);
    if (
      eventType === "user.created" &&
      deletedAt !== undefined &&
      eventTimestampMs > deletedAt
    ) {
      this.deletedUserTombstones.delete(userId);
    }
  }

  public recordUserDeletionCommitted(
    userId: string,
    eventTimestampMs: number,
  ): void {
    const prevDeletedAt = this.deletedUserTombstones.get(userId) ?? -Infinity;
    this.deletedUserTombstones.set(
      userId,
      Math.max(prevDeletedAt, eventTimestampMs),
    );
  }

  public markCompleted(
    svixId: string,
    result: WebhookProcessingResult,
    status: "PROCESSED" | "IGNORED" = "PROCESSED",
  ): void {
    const record = this.records.get(svixId);
    if (!record) return;
    record.status = status;
    record.result = result;
    record.lastError = undefined;
    record.updatedAtMs = this.nowFn();
  }

  public markFailed(
    svixId: string,
    errorMessage: string,
    permanent: boolean = false,
  ): ClerkWebhookInboxRecord | undefined {
    const record = this.records.get(svixId);
    if (!record) return undefined;
    record.lastError = errorMessage;
    record.updatedAtMs = this.nowFn();
    record.status =
      permanent || record.attemptCount >= this.maxAttempts
        ? "QUARANTINED"
        : "FAILED";
    return record;
  }

  /**
   * Reconciles inbox records stuck in PROCESSING beyond the lease duration.
   */
  public reconcileStuckRecords(): ClerkWebhookInboxRecord[] {
    const now = this.nowFn();
    const reconciled: ClerkWebhookInboxRecord[] = [];
    for (const record of this.records.values()) {
      if (
        record.status === "PROCESSING" &&
        now - record.updatedAtMs >= this.processingLeaseMs
      ) {
        record.status =
          record.attemptCount >= this.maxAttempts ? "QUARANTINED" : "FAILED";
        record.lastError = record.lastError ?? "Processing lease expired";
        record.updatedAtMs = now;
        reconciled.push(record);
      }
    }
    return reconciled;
  }

  public getRecord(svixId: string): ClerkWebhookInboxRecord | undefined {
    return this.records.get(svixId);
  }

  public getQuarantinedRecords(): ClerkWebhookInboxRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.status === "QUARANTINED",
    );
  }

  public clear(): void {
    this.records.clear();
    this.deletedUserTombstones.clear();
    this.latestUserEventTimestamps.clear();
  }
}

export const defaultClerkWebhookInbox = new ClerkWebhookInbox();
