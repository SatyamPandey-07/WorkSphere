import { createHash, randomBytes, timingSafeEqual } from "crypto";

export type GatewayCredentialStatus = "active" | "revoked";

export interface GatewayAuditEvent {
  timestamp: number;
  gatewayId: string;
  venueId: string;
  event:
    | "enrolled"
    | "rotated"
    | "revoked"
    | "auth_success"
    | "auth_failure"
    | "scope_denied";
  detail?: string;
}

export interface StoredGatewayRecord {
  gatewayId: string;
  venueId: string;
  activeKeyHash: string;
  retiringKeyHash?: string;
  retiringExpiresAt?: number;
  status: GatewayCredentialStatus;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface GatewayAuthResult {
  authenticated: boolean;
  gatewayId?: string;
  venueId?: string;
  keyRole?: "active" | "retiring";
  reason?: string;
}

export const MAX_ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ROTATION_OVERLAP_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeEqualHex(aHex: string, bHex: string): boolean {
  const bufA = Buffer.from(aHex, "hex");
  const bufB = Buffer.from(bHex, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Per-gateway credential registry supporting venue-scoped authorization,
 * bounded key rotation overlap, and immediate revocation without storing
 * plaintext credentials.
 */
export class GatewayAuthRegistry {
  private records = new Map<string, StoredGatewayRecord>();
  private auditEvents: GatewayAuditEvent[] = [];

  public enrollGateway(
    gatewayId: string,
    venueId: string,
    nowMs: number = Date.now(),
  ): { gatewayId: string; venueId: string; token: string } {
    if (!gatewayId.trim() || !venueId.trim()) {
      throw new Error("gatewayId and venueId are required");
    }
    const token = `gw_${randomBytes(32).toString("hex")}`;
    const record: StoredGatewayRecord = {
      gatewayId,
      venueId,
      activeKeyHash: hashToken(token),
      status: "active",
      createdAt: nowMs,
    };
    this.records.set(gatewayId, record);
    this.auditEvents.push({
      timestamp: nowMs,
      gatewayId,
      venueId,
      event: "enrolled",
    });
    return { gatewayId, venueId, token };
  }

  public rotateGatewayKey(
    gatewayId: string,
    overlapWindowMs: number = DEFAULT_ROTATION_OVERLAP_MS,
    nowMs: number = Date.now(),
  ): { gatewayId: string; venueId: string; token: string; overlapExpiresAt: number } {
    const existing = this.records.get(gatewayId);
    if (!existing) {
      throw new Error(`Gateway ${gatewayId} is not enrolled`);
    }
    if (existing.status === "revoked") {
      throw new Error(`Cannot rotate key for revoked gateway ${gatewayId}`);
    }

    const boundedOverlap = Math.max(
      0,
      Math.min(overlapWindowMs, MAX_ROTATION_OVERLAP_MS),
    );
    const token = `gw_${randomBytes(32).toString("hex")}`;
    const overlapExpiresAt = nowMs + boundedOverlap;

    existing.retiringKeyHash =
      boundedOverlap > 0 ? existing.activeKeyHash : undefined;
    existing.retiringExpiresAt =
      boundedOverlap > 0 ? overlapExpiresAt : undefined;
    existing.activeKeyHash = hashToken(token);

    this.auditEvents.push({
      timestamp: nowMs,
      gatewayId,
      venueId: existing.venueId,
      event: "rotated",
      detail: `overlapMs=${boundedOverlap}`,
    });

    return {
      gatewayId,
      venueId: existing.venueId,
      token,
      overlapExpiresAt,
    };
  }

  public revokeGateway(gatewayId: string, nowMs: number = Date.now()): void {
    const existing = this.records.get(gatewayId);
    if (!existing) return;

    existing.status = "revoked";
    existing.activeKeyHash = "";
    existing.retiringKeyHash = undefined;
    existing.retiringExpiresAt = undefined;
    existing.revokedAt = nowMs;

    this.auditEvents.push({
      timestamp: nowMs,
      gatewayId,
      venueId: existing.venueId,
      event: "revoked",
    });
  }

  public authenticateToken(
    token: string,
    nowMs: number = Date.now(),
  ): GatewayAuthResult {
    if (!token) {
      return { authenticated: false, reason: "Missing gateway token" };
    }

    const presentedHash = hashToken(token);

    for (const record of this.records.values()) {
      if (record.status === "revoked") continue;

      if (
        record.activeKeyHash &&
        safeEqualHex(presentedHash, record.activeKeyHash)
      ) {
        record.lastUsedAt = nowMs;
        this.auditEvents.push({
          timestamp: nowMs,
          gatewayId: record.gatewayId,
          venueId: record.venueId,
          event: "auth_success",
          detail: "active",
        });
        return {
          authenticated: true,
          gatewayId: record.gatewayId,
          venueId: record.venueId,
          keyRole: "active",
        };
      }

      if (
        record.retiringKeyHash &&
        record.retiringExpiresAt !== undefined &&
        nowMs <= record.retiringExpiresAt &&
        safeEqualHex(presentedHash, record.retiringKeyHash)
      ) {
        record.lastUsedAt = nowMs;
        this.auditEvents.push({
          timestamp: nowMs,
          gatewayId: record.gatewayId,
          venueId: record.venueId,
          event: "auth_success",
          detail: "retiring",
        });
        return {
          authenticated: true,
          gatewayId: record.gatewayId,
          venueId: record.venueId,
          keyRole: "retiring",
        };
      }
    }

    this.auditEvents.push({
      timestamp: nowMs,
      gatewayId: "unknown",
      venueId: "unknown",
      event: "auth_failure",
    });
    return { authenticated: false, reason: "Invalid or expired gateway token" };
  }

  public isVenueAuthorized(
    gatewayId: string,
    targetVenueId: string,
    nowMs: number = Date.now(),
  ): boolean {
    const record = this.records.get(gatewayId);
    if (!record || record.status === "revoked") return false;
    const allowed = record.venueId === targetVenueId;
    if (!allowed) {
      this.auditEvents.push({
        timestamp: nowMs,
        gatewayId,
        venueId: record.venueId,
        event: "scope_denied",
        detail: `requestedVenue=${targetVenueId}`,
      });
    }
    return allowed;
  }

  public getRecord(gatewayId: string): StoredGatewayRecord | undefined {
    const r = this.records.get(gatewayId);
    return r ? { ...r } : undefined;
  }

  public getAuditEvents(): GatewayAuditEvent[] {
    return [...this.auditEvents];
  }

  public hasEnrolledGateways(): boolean {
    return this.records.size > 0;
  }
}

export const defaultGatewayRegistry = new GatewayAuthRegistry();
