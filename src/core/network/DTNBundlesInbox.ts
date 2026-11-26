import { createHash } from "crypto";

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

export interface IncomingFragment {
  logicalBundleId: string;
  source: string;
  destination: string;
  fragmentOffset: number;
  totalPayloadLength: number;
  payloadBase64: string;
  creationTimestamp: number;
  lifetimeMs: number;
}

export interface StoredBundleRecord {
  logicalBundleId: string;
  source: string;
  destination: string;
  totalPayloadLength: number;
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

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
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
    duplicate?: boolean;
    receipt?: DTNDeliveryReceipt;
    error?: string;
  } {
    const expiresAtMs = fragment.creationTimestamp + fragment.lifetimeMs;
    if (nowMs >= expiresAtMs) {
      return {
        accepted: false,
        status: "expired",
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
        error: `Payload length ${fragment.totalPayloadLength} exceeds limit ${this.maxTotalPayloadBytes}`,
      };
    }

    if (fragment.fragmentOffset < 0) {
      return {
        accepted: false,
        status: "failed",
        error: "Negative fragmentOffset is invalid",
      };
    }

    let record = this.bundles.get(fragment.logicalBundleId);
    if (!record) {
      record = {
        logicalBundleId: fragment.logicalBundleId,
        source: fragment.source,
        destination: fragment.destination,
        totalPayloadLength: fragment.totalPayloadLength,
        expiresAtMs,
        status: "received",
        fragments: {},
        receipts: [],
      };
      this.bundles.set(fragment.logicalBundleId, record);
    }

    if (record.status === "delivered") {
      return {
        accepted: true,
        status: "delivered",
        duplicate: true,
        receipt: record.receipts.find((r) => r.kind === "application_delivery"),
      };
    }

    if (record.totalPayloadLength !== fragment.totalPayloadLength) {
      return {
        accepted: false,
        status: record.status,
        error: "Conflicting totalPayloadLength for existing logicalBundleId",
      };
    }

    const existingFrag = record.fragments[fragment.fragmentOffset];
    if (existingFrag !== undefined) {
      if (existingFrag === fragment.payloadBase64) {
        return {
          accepted: true,
          status: record.status,
          duplicate: true,
        };
      }
      return {
        accepted: false,
        status: record.status,
        error: `Conflicting fragment bytes at offset ${fragment.fragmentOffset}`,
      };
    }

    if (Object.keys(record.fragments).length >= this.maxFragmentsPerBundle) {
      return {
        accepted: false,
        status: "failed",
        error: `Fragment count exceeds maxFragmentsPerBundle (${this.maxFragmentsPerBundle})`,
      };
    }

    record.fragments[fragment.fragmentOffset] = fragment.payloadBase64;
    record.status = "assembling";

    // Attempt assembly
    const assembled = this.tryAssemble(record);
    if (assembled !== null) {
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
        receipt: completeReceipt,
      };
    }

    const transportReceipt = this.issueReceipt(record, "transport", nowMs);
    return {
      accepted: true,
      status: "assembling",
      receipt: transportReceipt,
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
      if (record.status === "processing") {
        record.status = record.assembledPayloadBase64 ? "ready" : "assembling";
        record.claimedByWorker = undefined;
      }
    }
  }
}

export const defaultDtnInbox = new DTNBundlesInbox();
