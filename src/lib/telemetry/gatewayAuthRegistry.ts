export type GatewayKeyStatus = 'active' | 'grace' | 'retired' | 'revoked';

export interface GatewayCredentialRecord {
  keyId: string;
  gatewayId: string;
  secretOrVerifier: string;
  scopes: string[];
  status: GatewayKeyStatus;
  issuedAtMs: number;
  expiresAtMs?: number;
  graceUntilMs?: number;
  revokedAtMs?: number;
  revokedReason?: string;
  lastUsedAtMs?: number;
  lastUsedAt?: string;
}

export interface GatewayVerifyRequest {
  gatewayId: string;
  keyId: string;
  tokenSecret: string;
  requiredScopes?: readonly string[];
  nowMs?: number;
}

export interface GatewayVerifyResult {
  valid: boolean;
  gatewayId: string;
  keyId: string;
  status?: GatewayKeyStatus;
  lastUsedAtMs?: number;
  reason?: string;
}

export interface GatewayAuthRegistryOptions {
  nowFn?: () => number;
  lastUsedFlushIntervalMs?: number;
  onLastUsedRecorded?: (record: GatewayCredentialRecord) => void | Promise<void>;
}

interface InternalGatewayRecord extends GatewayCredentialRecord {
  scopesSet: Set<string>;
}

export class GatewayAuthRegistry {
  private readonly nowFn: () => number;
  private readonly lastUsedFlushIntervalMs: number;
  private readonly onLastUsedRecorded?: (record: GatewayCredentialRecord) => void | Promise<void>;
  private readonly records = new Map<string, InternalGatewayRecord>();
  private readonly revokedGateways = new Set<string>();

  constructor(options: GatewayAuthRegistryOptions = {}) {
    this.nowFn = options.nowFn ?? Date.now;
    this.lastUsedFlushIntervalMs = typeof options.lastUsedFlushIntervalMs === 'number' && Number.isFinite(options.lastUsedFlushIntervalMs) && options.lastUsedFlushIntervalMs >= 0 ? Math.floor(options.lastUsedFlushIntervalMs) : 0;
    this.onLastUsedRecorded = options.onLastUsedRecorded;
  }

  private compositeKey(gatewayId: string, keyId: string): string {
    return `${gatewayId}::${keyId}`;
  }

  private refreshLifecycle(record: InternalGatewayRecord, nowMs: number): void {
    if (record.status === 'revoked') return;
    if (typeof record.expiresAtMs === 'number' && nowMs >= record.expiresAtMs) {
      record.status = 'retired';
      return;
    }
    if (record.status === 'grace' && typeof record.graceUntilMs === 'number' && nowMs >= record.graceUntilMs) {
      record.status = 'retired';
    }
  }

  public enrollGatewayCredential(params: { gatewayId: string; keyId: string; secretOrVerifier: string; scopes?: readonly string[]; ttlMs?: number; status?: Extract<GatewayKeyStatus, 'active' | 'grace'>; nowMs?: number }): GatewayCredentialRecord {
    const now = params.nowMs ?? this.nowFn();
    const scopes = Array.from(new Set((params.scopes ?? []).map((s) => s.trim()).filter(Boolean)));
    const expiresAtMs = typeof params.ttlMs === 'number' && Number.isFinite(params.ttlMs) && params.ttlMs > 0 ? now + Math.floor(params.ttlMs) : undefined;
    const internal: InternalGatewayRecord = { gatewayId: params.gatewayId.trim(), keyId: params.keyId.trim(), secretOrVerifier: params.secretOrVerifier, scopes, scopesSet: new Set(scopes), status: params.status ?? 'active', issuedAtMs: now, expiresAtMs };
    this.records.set(this.compositeKey(internal.gatewayId, internal.keyId), internal);
    return this.toPublicRecord(internal);
  }

  public rotateGatewayKey(params: { gatewayId: string; newKeyId: string; newSecretOrVerifier: string; scopes?: readonly string[]; graceWindowMs?: number; ttlMs?: number; nowMs?: number }): GatewayCredentialRecord {
    const now = params.nowMs ?? this.nowFn();
    const gwId = params.gatewayId.trim();
    const graceMs = typeof params.graceWindowMs === 'number' && Number.isFinite(params.graceWindowMs) && params.graceWindowMs >= 0 ? Math.floor(params.graceWindowMs) : 60_000;
    for (const [key, rec] of this.records.entries()) {
      if (rec.gatewayId === gwId && rec.status === 'active') {
        rec.status = 'grace';
        rec.graceUntilMs = now + graceMs;
        this.records.set(key, rec);
      }
    }
    return this.enrollGatewayCredential({ gatewayId: gwId, keyId: params.newKeyId, secretOrVerifier: params.newSecretOrVerifier, scopes: params.scopes, ttlMs: params.ttlMs, status: 'active', nowMs: now });
  }

  public revokeKey(gatewayId: string, keyId: string, reason = 'Credential revoked', nowMs: number = this.nowFn()): boolean {
    const rec = this.records.get(this.compositeKey(gatewayId, keyId));
    if (!rec) return false;
    rec.status = 'revoked';
    rec.revokedAtMs = nowMs;
    rec.revokedReason = reason;
    return true;
  }

  public revokeGateway(gatewayId: string): void {
    const normalizedGatewayId = gatewayId.trim();
    this.revokedGateways.add(normalizedGatewayId);
    for (const record of this.records.values()) {
      if (record.gatewayId === normalizedGatewayId) {
        delete record.lastUsedAtMs;
        delete record.lastUsedAt;
      }
    }
  }

  private scheduleLastUsedAudit(record: InternalGatewayRecord, nowMs: number): void {
    const previousMs = record.lastUsedAtMs ?? 0;
    if (this.lastUsedFlushIntervalMs > 0 && previousMs > 0 && nowMs - previousMs < this.lastUsedFlushIntervalMs) return;
    record.lastUsedAtMs = nowMs;
    record.lastUsedAt = new Date(nowMs).toISOString();
    if (this.onLastUsedRecorded) {
      const snapshot = this.toPublicRecord(record);
      queueMicrotask(() => {
        try {
          const maybePromise = this.onLastUsedRecorded?.(snapshot);
          if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === 'function') {
            void (maybePromise as Promise<unknown>).catch(() => undefined);
          }
        } catch {
          // Non-blocking audit listener
        }
      });
    }
  }

  public verifyCredential(request: GatewayVerifyRequest): GatewayVerifyResult {
    const now = typeof request.nowMs === 'number' && Number.isFinite(request.nowMs) ? Math.floor(request.nowMs) : this.nowFn();
    const gwId = request.gatewayId.trim();
    const kId = request.keyId.trim();
    if (this.revokedGateways.has(gwId)) {
      return { valid: false, gatewayId: gwId, keyId: kId, status: 'revoked', reason: `Gateway "${gwId}" is revoked` };
    }
    const record = this.records.get(this.compositeKey(gwId, kId));
    if (!record) {
      return { valid: false, gatewayId: gwId, keyId: kId, reason: `Unknown credential "${kId}" for gateway "${gwId}"` };
    }
    this.refreshLifecycle(record, now);
    if (record.status === 'revoked' || record.status === 'retired') {
      return { valid: false, gatewayId: gwId, keyId: kId, status: record.status, lastUsedAtMs: record.lastUsedAtMs, reason: `Credential "${kId}" is ${record.status}` };
    }
    if (record.secretOrVerifier !== request.tokenSecret) {
      return { valid: false, gatewayId: gwId, keyId: kId, status: record.status, lastUsedAtMs: record.lastUsedAtMs, reason: 'Invalid credential secret' };
    }
    for (const scope of request.requiredScopes ?? []) {
      const trimmed = scope.trim();
      if (trimmed && !record.scopesSet.has(trimmed)) {
        return { valid: false, gatewayId: gwId, keyId: kId, status: record.status, lastUsedAtMs: record.lastUsedAtMs, reason: `Missing required scope "${trimmed}"` };
      }
    }
    this.scheduleLastUsedAudit(record, now);
    return { valid: true, gatewayId: gwId, keyId: kId, status: record.status, lastUsedAtMs: record.lastUsedAtMs };
  }

  public getCredentialRecord(gatewayId: string, keyId: string): GatewayCredentialRecord | undefined {
    const rec = this.records.get(this.compositeKey(gatewayId, keyId));
    return rec ? this.toPublicRecord(rec) : undefined;
  }

  public listStaleCredentials(maxIdleMs: number, now?: number): GatewayCredentialRecord[] {
    const nowMs = now ?? this.nowFn();
    return Array.from(this.records.values())
      .filter((record) => {
        if (typeof record.lastUsedAtMs !== 'number' || !Number.isFinite(record.lastUsedAtMs)) return false;
        return nowMs - record.lastUsedAtMs > maxIdleMs;
      })
      .map((record) => this.toPublicRecord(record));
  }

  private toPublicRecord(rec: InternalGatewayRecord): GatewayCredentialRecord {
    return { keyId: rec.keyId, gatewayId: rec.gatewayId, secretOrVerifier: rec.secretOrVerifier, scopes: [...rec.scopes], status: rec.status, issuedAtMs: rec.issuedAtMs, expiresAtMs: rec.expiresAtMs, graceUntilMs: rec.graceUntilMs, revokedAtMs: rec.revokedAtMs, revokedReason: rec.revokedReason, lastUsedAtMs: rec.lastUsedAtMs, lastUsedAt: rec.lastUsedAt };
  }
}

export class ExtendedGatewayAuthRegistry extends GatewayAuthRegistry {
  private readonly gatewayVenues = new Map<string, Set<string>>();

  public bindGatewayVenues(gatewayId: string, venueIds: readonly string[]): void {
    const normalizedGatewayId = gatewayId.trim();
    const existing = this.gatewayVenues.get(normalizedGatewayId) ?? new Set<string>();
    for (const venueId of venueIds) {
      const trimmed = venueId.trim();
      if (trimmed) existing.add(trimmed);
    }
    this.gatewayVenues.set(normalizedGatewayId, existing);
  }

  public authenticateToken(
    token: string,
    requiredScopes: readonly string[] = ["telemetry:write"]
  ): { authenticated: boolean; gatewayId?: string; keyId?: string; scopes?: string[]; reason?: string } {
    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return { authenticated: false, reason: "Missing gateway token" };
    }
    const parts = token.trim().split(":");
    if (parts.length < 3) {
      return { authenticated: false, reason: "Malformed gateway token" };
    }
    const [gatewayId, keyId, ...secretParts] = parts;
    const tokenSecret = secretParts.join(":");
    const verified = this.verifyCredential({
      gatewayId,
      keyId,
      tokenSecret,
      requiredScopes,
    });
    if (!verified.valid) {
      return { authenticated: false, gatewayId, keyId, reason: verified.reason };
    }
    const rec = this.getCredentialRecord(gatewayId, keyId);
    return {
      authenticated: true,
      gatewayId: verified.gatewayId,
      keyId: verified.keyId,
      scopes: rec?.scopes ?? [],
    };
  }

  public hasEnrolledGateways(): boolean {
    return this.listStaleCredentials(-1).length > 0 || (this as unknown as { records: Map<string, unknown> }).records.size > 0;
  }

  public isVenueAuthorized(gatewayId: string, venueId: string): boolean {
    const normalizedGatewayId = gatewayId.trim();
    const allowedVenues = this.gatewayVenues.get(normalizedGatewayId);
    if (!allowedVenues || allowedVenues.size === 0) {
      return false;
    }
    return allowedVenues.has("*") || allowedVenues.has(venueId.trim());
  }
}

export const defaultGatewayRegistry = new ExtendedGatewayAuthRegistry();
export default GatewayAuthRegistry;