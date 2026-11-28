import { createHash } from "crypto";

export type BundlePriorityTier = "critical" | "normal" | "bulk";

const PRIORITY_RANK: Record<BundlePriorityTier, number> = {
  critical: 3,
  normal: 2,
  bulk: 1,
};

/**
 * Normalizes explicit priority tiers, numeric BundlePriority values, or
 * semantic bundle categories (e.g. emergency, check-in, telemetry) into a tier.
 */
export function normalizeBundlePriority(
  rawPriority?: unknown,
  categoryHint?: unknown,
): BundlePriorityTier {
  if (typeof rawPriority === "string") {
    const normalized = rawPriority.trim().toLowerCase();
    if (normalized === "critical" || normalized === "emergency") {
      return "critical";
    }
    if (normalized === "bulk" || normalized === "telemetry") {
      return "bulk";
    }
    if (normalized === "normal" || normalized === "expedited") {
      return "normal";
    }
  }

  if (typeof rawPriority === "number" && Number.isFinite(rawPriority)) {
    if (rawPriority >= 3) return "critical";
    if (rawPriority <= 0) return "bulk";
    return "normal";
  }

  if (typeof categoryHint === "string") {
    const hint = categoryHint.trim().toLowerCase();
    if (hint === "emergency" || hint === "sos" || hint === "alert") {
      return "critical";
    }
    if (
      hint === "telemetry" ||
      hint === "bulk_telemetry" ||
      hint === "bulk-telemetry" ||
      hint === "metrics"
    ) {
      return "bulk";
    }
  }

  return "normal";
}

export function comparePriorityTiers(
  a: BundlePriorityTier,
  b: BundlePriorityTier,
): number {
  return PRIORITY_RANK[b] - PRIORITY_RANK[a];
}

export type BundleLifecycleStatus =
  | "received"
  | "assembling"
  | "ready"
  | "processing"
  | "delivered"
  | "failed"
  | "expired";

export type ReceiptKind =
  | "transport"
  | "complete_bundle"
  | "application_delivery";

export interface DTNDeliveryReceipt {
  receiptId: string;
  logicalBundleId: string;
  kind: ReceiptKind;
  issuedAtMs: number;
  digest: string;
}

export interface BundleIntegrityError {
  code: "PAYLOAD_DIGEST_MISMATCH";
  expectedDigest: string;
  actualDigest: string;
}

export interface IncomingFragment {
  logicalBundleId: string;
  source: string;
  destination: string;
  fragmentOffset: number;
  totalPayloadLength: number;
  payloadBase64: string;
  expectedPayloadDigest?: string;
  creationTimestamp: number;
  lifetimeMs: number;
  priority?: BundlePriorityTier;
  category?: string;
}

export interface StoredBundleRecord {
  logicalBundleId: string;
  source: string;
  destination: string;
  priority: BundlePriorityTier;
  creationTimestamp: number;
  ingestedSeq: number;
  totalPayloadLength: number;
  expectedPayloadDigest?: string;
  expiresAtMs: number;
  status: BundleLifecycleStatus;
  fragments: Record<number, string>; // offset -> base64
  assembledPayloadBase64?: string;
  claimedByWorker?: string;
  deliveredAtMs?: number;
  receipts: DTNDeliveryReceipt[];
  lastError?: string;
}

export interface DTNInboxLimits {
  maxTotalPayloadBytes?: number;
  maxFragmentsPerBundle?: number;
}

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Durable-ready DTN bundle inbox, bounded fragment assembler,
 * concurrency-safe lifecycle state machine, and transactional receipt issuer.
 */
export class DTNBundlesInbox {
  private bundles = new Map<string, StoredBundleRecord>();
  private maxTotalPayloadBytes: number;
  private maxFragmentsPerBundle: number;
  private receiptSeq = 0;
  private ingestSeq = 0;

  constructor(limits: DTNInboxLimits = {}) {
    this.maxTotalPayloadBytes = limits.maxTotalPayloadBytes ?? 1024 * 1024; // 1 MiB
    this.maxFragmentsPerBundle = limits.maxFragmentsPerBundle ?? 4096;
  }

  public ingestFragment(
    fragment: IncomingFragment,
    nowMs: number = Date.now(),
  ): {
    accepted: boolean;
    status: BundleLifecycleStatus;
    priority: BundlePriorityTier;
    duplicate?: boolean;
    receipt?: DTNDeliveryReceipt;
    error?: string;
    integrityError?: BundleIntegrityError;
  } {
    const priority = normalizeBundlePriority(
      fragment.priority,
      fragment.category,
    );
    const expiresAtMs = fragment.creationTimestamp + fragment.lifetimeMs;
    if (nowMs >= expiresAtMs) {
      return {
        accepted: false,
        status: "expired",
        priority,
        error: "Bundle has expired",
      };
    }

    if (
      fragment.totalPayloadLength <= 0 ||
      fragment.totalPayloadLength > this.maxTotalPayloadBytes
    ) {
      return {
        accepted: false,
        status: "failed",
        priority,
        error: `Payload length ${fragment.totalPayloadLength} exceeds limit ${this.maxTotalPayloadBytes}`,
      };
    }

    if (fragment.fragmentOffset < 0) {
      return {
        accepted: false,
        status: "failed",
        priority,
        error: "Negative fragmentOffset is invalid",
      };
    }

    let record = this.bundles.get(fragment.logicalBundleId);
    if (!record) {
      record = {
        logicalBundleId: fragment.logicalBundleId,
        source: fragment.source,
        destination: fragment.destination,
        priority,
        creationTimestamp: fragment.creationTimestamp,
        ingestedSeq: ++this.ingestSeq,
        totalPayloadLength: fragment.totalPayloadLength,
        expectedPayloadDigest: fragment.expectedPayloadDigest,
        expiresAtMs,
        status: "received",
        fragments: {},
        receipts: [],
      };
      this.bundles.set(fragment.logicalBundleId, record);
    } else if (PRIORITY_RANK[priority] > PRIORITY_RANK[record.priority]) {
      record.priority = priority;
    }

    if (record.status === "delivered") {
      return {
        accepted: true,
        status: "delivered",
        priority: record.priority,
        duplicate: true,
        receipt: record.receipts.find((r) => r.kind === "application_delivery"),
      };
    }

    if (record.totalPayloadLength !== fragment.totalPayloadLength) {
      return {
        accepted: false,
        status: record.status,
        priority: record.priority,
        error: "Conflicting totalPayloadLength for existing logicalBundleId",
      };
    }

    if (fragment.expectedPayloadDigest !== undefined) {
      if (
        record.expectedPayloadDigest !== undefined &&
        record.expectedPayloadDigest.toLowerCase() !==
          fragment.expectedPayloadDigest.toLowerCase()
      ) {
        return {
          accepted: false,
          status: record.status,
          priority: record.priority,
          error: "Conflicting expected payload digests for existing bundle",
        };
      }
      record.expectedPayloadDigest ??= fragment.expectedPayloadDigest;
    }

    const existingFrag = record.fragments[fragment.fragmentOffset];
    if (existingFrag !== undefined) {
      const existingPayloadLength = Buffer.from(existingFrag, "base64").byteLength;
      const incomingPayloadLength = Buffer.from(
        fragment.payloadBase64,
        "base64",
      ).byteLength;
      if (existingPayloadLength === incomingPayloadLength) {
        return {
          accepted: true,
          status: record.status,
          priority: record.priority,
          duplicate: true,
        };
      }
      return {
        accepted: false,
        status: record.status,
        priority: record.priority,
        error: `Conflicting fragment bytes at offset ${fragment.fragmentOffset}`,
      };
    }

    if (Object.keys(record.fragments).length >= this.maxFragmentsPerBundle) {
      return {
        accepted: false,
        status: "failed",
        priority: record.priority,
        error: `Fragment count exceeds maxFragmentsPerBundle (${this.maxFragmentsPerBundle})`,
      };
    }

    record.fragments[fragment.fragmentOffset] = fragment.payloadBase64;
    record.status = "assembling";

    // Attempt assembly
    const assembled = this.tryAssemble(record);
    if (assembled !== null) {
      if (record.expectedPayloadDigest !== undefined) {
        const actualDigest = sha256Hex(Buffer.from(assembled, "base64"));
        if (
          actualDigest !== record.expectedPayloadDigest.toLowerCase()
        ) {
          record.status = "failed";
          record.lastError = "SHA-256 payload digest mismatch";
          const integrityError: BundleIntegrityError = {
            code: "PAYLOAD_DIGEST_MISMATCH",
            expectedDigest: record.expectedPayloadDigest,
            actualDigest,
          };
          return {
            accepted: false,
            status: "failed",
            priority: record.priority,
            error: record.lastError,
            integrityError,
          };
        }
      }

      record.assembledPayloadBase64 = assembled;
      record.status = "ready";
      const completeReceipt = this.issueReceipt(
        record,
        "complete_bundle",
        nowMs,
      );
      return {
        accepted: true,
        status: "ready",
        priority: record.priority,
        receipt: completeReceipt,
      };
    }

    const transportReceipt = this.issueReceipt(record, "transport", nowMs);
    return {
      accepted: true,
      status: "assembling",
      priority: record.priority,
      receipt: transportReceipt,
    };
  }

  /**
   * Orders incoming fragments by bundle priority (`critical` > `normal` > `bulk`),
   * preserving relative arrival order within the same tier.
   */
  public prioritizeFragments<
    T extends Pick<IncomingFragment, "priority" | "category">,
  >(fragments: readonly T[]): T[] {
    return fragments
      .map((fragment, index) => ({
        fragment,
        index,
        tier: normalizeBundlePriority(fragment.priority, fragment.category),
      }))
      .sort(
        (a, b) =>
          comparePriorityTiers(a.tier, b.tier) || a.index - b.index,
      )
      .map((entry) => entry.fragment);
  }

  /**
   * Ingests a batch of fragments in priority queue order (`critical`, then `normal`, then `bulk`).
   */
  public ingestFragmentsPrioritized(
    fragments: readonly IncomingFragment[],
    nowMs: number = Date.now(),
  ) {
    return this.prioritizeFragments(fragments).map((fragment) => ({
      logicalBundleId: fragment.logicalBundleId,
      ...this.ingestFragment(fragment, nowMs),
    }));
  }

  /**
   * Returns all `ready` bundles ordered by priority tier (`critical` > `normal` > `bulk`),
   * tie-breaking by earlier creationTimestamp and FIFO ingestion sequence.
   */
  public getPrioritizedReadyBundles(): StoredBundleRecord[] {
    return Array.from(this.bundles.values())
      .filter((record) => record.status === "ready")
      .sort(
        (a, b) =>
          comparePriorityTiers(a.priority, b.priority) ||
          a.creationTimestamp - b.creationTimestamp ||
          a.ingestedSeq - b.ingestedSeq,
      )
      .map((record) => structuredClone(record));
  }

  /**
   * Delivers the highest-priority non-expired `ready` bundle in the queue.
   */
  public async deliverNextReady(
    workerId: string,
    applyFn: (payloadBase64: string, record: StoredBundleRecord) => Promise<void>,
    nowMs: number = Date.now(),
  ): Promise<{
    logicalBundleId?: string;
    priority?: BundlePriorityTier;
    delivered: boolean;
    alreadyDelivered?: boolean;
    receipt?: DTNDeliveryReceipt;
    error?: string;
  }> {
    this.purgeExpired(nowMs);
    const next = this.getPrioritizedReadyBundles()[0];
    if (!next) {
      return { delivered: false, error: "No ready bundles in queue" };
    }
    const result = await this.deliverBundle(
      next.logicalBundleId,
      workerId,
      applyFn,
      nowMs,
    );
    return {
      logicalBundleId: next.logicalBundleId,
      priority: next.priority,
      ...result,
    };
  }

  private tryAssemble(record: StoredBundleRecord): string | null {
    const offsets = Object.keys(record.fragments)
      .map(Number)
      .sort((a, b) => a - b);

    if (offsets.length === 0 || offsets[0] !== 0) return null;

    const chunks: Buffer[] = [];
    let cursor = 0;
    for (const offset of offsets) {
      if (offset !== cursor) return null;
      const buf = Buffer.from(record.fragments[offset], "base64");
      chunks.push(buf);
      cursor += buf.length;
    }

    if (cursor !== record.totalPayloadLength) return null;
    return Buffer.concat(chunks).toString("base64");
  }

  /**
   * Claims a `ready` bundle for application delivery (single-winner guard)
   * and commits an `application_delivery` receipt ONLY after `applyFn` resolves.
   */
  public async deliverBundle(
    logicalBundleId: string,
    workerId: string,
    applyFn: (payloadBase64: string, record: StoredBundleRecord) => Promise<void>,
    nowMs: number = Date.now(),
  ): Promise<{
    delivered: boolean;
    alreadyDelivered?: boolean;
    receipt?: DTNDeliveryReceipt;
    error?: string;
  }> {
    const record = this.bundles.get(logicalBundleId);
    if (!record) {
      return { delivered: false, error: "Bundle not found" };
    }
    if (nowMs >= record.expiresAtMs && record.status !== "delivered") {
      record.status = "expired";
      return { delivered: false, error: "Bundle expired before delivery" };
    }
    if (record.status === "delivered") {
      return {
        delivered: true,
        alreadyDelivered: true,
        receipt: record.receipts.find((r) => r.kind === "application_delivery"),
      };
    }
    if (record.status !== "ready" || !record.assembledPayloadBase64) {
      return {
        delivered: false,
        error: `Bundle status is '${record.status}', not ready for delivery`,
      };
    }
    if (record.claimedByWorker && record.claimedByWorker !== workerId) {
      return {
        delivered: false,
        error: `Bundle already claimed by worker '${record.claimedByWorker}'`,
      };
    }

    record.claimedByWorker = workerId;
    record.status = "processing";

    try {
      await applyFn(record.assembledPayloadBase64, record);
      record.status = "delivered";
      record.deliveredAtMs = nowMs;
      const receipt = this.issueReceipt(record, "application_delivery", nowMs);
      return { delivered: true, receipt };
    } catch (err) {
      record.status = "ready";
      record.claimedByWorker = undefined;
      record.lastError =
        err instanceof Error ? err.message : "Application delivery failed";
      return { delivered: false, error: record.lastError };
    }
  }

  private issueReceipt(
    record: StoredBundleRecord,
    kind: ReceiptKind,
    nowMs: number,
  ): DTNDeliveryReceipt {
    const receipt: DTNDeliveryReceipt = {
      receiptId: `rcpt_${nowMs}_${++this.receiptSeq}`,
      logicalBundleId: record.logicalBundleId,
      kind,
      issuedAtMs: nowMs,
      digest: sha256Hex(
        `${record.logicalBundleId}:${kind}:${record.totalPayloadLength}:${nowMs}`,
      ),
    };
    record.receipts.push(receipt);
    return receipt;
  }

  public purgeExpired(nowMs: number = Date.now()): string[] {
    const purged: string[] = [];
    for (const [id, record] of this.bundles.entries()) {
      if (record.status !== "delivered" && nowMs >= record.expiresAtMs) {
        record.status = "expired";
        this.bundles.delete(id);
        purged.push(id);
      }
    }
    return purged;
  }

  public getBundle(logicalBundleId: string): StoredBundleRecord | undefined {
    const r = this.bundles.get(logicalBundleId);
    return r ? structuredClone(r) : undefined;
  }

  /** Serializes inbox state so it can survive a process restart. */
  public exportSnapshot(): string {
    return JSON.stringify(Array.from(this.bundles.entries()));
  }

  /** Restores inbox state after a process restart. */
  public importSnapshot(snapshotJson: string): void {
    const entries = JSON.parse(snapshotJson) as Array<
      [string, StoredBundleRecord]
    >;
    this.bundles = new Map(entries);
    // Recover any bundles that were mid-processing during crash back to ready
    for (const record of this.bundles.values()) {
      record.priority = normalizeBundlePriority(record.priority);
      if (typeof record.creationTimestamp !== "number") {
        record.creationTimestamp = 0;
      }
      if (typeof record.ingestedSeq !== "number") {
        record.ingestedSeq = ++this.ingestSeq;
      } else if (record.ingestedSeq > this.ingestSeq) {
        this.ingestSeq = record.ingestedSeq;
      }
      if (record.status === "processing") {
        record.status = record.assembledPayloadBase64 ? "ready" : "assembling";
        record.claimedByWorker = undefined;
      }
    }
  }
}

export const defaultDtnInbox = new DTNBundlesInbox();
