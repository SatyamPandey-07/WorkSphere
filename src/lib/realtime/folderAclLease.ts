export interface FolderAclLeaseRecord {
  leaseId: string;
  userId: string;
  folderId: string;
  roomId?: string;
  aclVersion: number;
  issuedAtMs: number;
  expiresAtMs: number;
  ttlMs: number;
  revokedAtMs?: number;
  revokedReason?: string;
}

export interface LeaseExpiringWarningEvent {
  type: 'lease_expiring';
  leaseId: string;
  userId: string;
  folderId: string;
  roomId?: string;
  aclVersion: number;
  expiresAtMs: number;
  remainingMs: number;
  emittedAtMs: number;
}

export type LeaseExpiringListener = (event: LeaseExpiringWarningEvent) => void;

export interface FolderAclLeaseManagerOptions {
  defaultTtlMs?: number;
  warningLeadMs?: number;
  nowFn?: () => number;
  onLeaseExpiring?: LeaseExpiringListener;
}

export const DEFAULT_LEASE_TTL_MS = 120_000;
export const DEFAULT_LEASE_WARNING_LEAD_MS = 30_000;

interface ManagedLeaseState {
  record: FolderAclLeaseRecord;
  warningEmittedForWindow: boolean;
}

export class FolderAclLeaseManager {
  public readonly defaultTtlMs: number;
  public readonly warningLeadMs: number;
  private readonly nowFn: () => number;
  private readonly leases = new Map<string, ManagedLeaseState>();
  private readonly listeners = new Set<LeaseExpiringListener>();
  private leaseSeq = 0;

  constructor(options: FolderAclLeaseManagerOptions = {}) {
    this.defaultTtlMs = typeof options.defaultTtlMs === 'number' && Number.isFinite(options.defaultTtlMs) && options.defaultTtlMs > 0 ? Math.floor(options.defaultTtlMs) : DEFAULT_LEASE_TTL_MS;
    this.warningLeadMs = typeof options.warningLeadMs === 'number' && Number.isFinite(options.warningLeadMs) && options.warningLeadMs >= 0 ? Math.floor(options.warningLeadMs) : DEFAULT_LEASE_WARNING_LEAD_MS;
    this.nowFn = options.nowFn ?? Date.now;
    if (options.onLeaseExpiring) this.listeners.add(options.onLeaseExpiring);
  }

  public onLeaseExpiring(listener: LeaseExpiringListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  public issueLease(params: { userId: string; folderId: string; roomId?: string; aclVersion?: number; ttlMs?: number; nowMs?: number }): FolderAclLeaseRecord {
    const now = typeof params.nowMs === 'number' && Number.isFinite(params.nowMs) ? Math.floor(params.nowMs) : this.nowFn();
    const ttlMs = typeof params.ttlMs === 'number' && Number.isFinite(params.ttlMs) && params.ttlMs > 0 ? Math.floor(params.ttlMs) : this.defaultTtlMs;
    this.leaseSeq += 1;
    const leaseId = `lease___`;
    const record: FolderAclLeaseRecord = { leaseId, userId: params.userId, folderId: params.folderId, roomId: params.roomId, aclVersion: typeof params.aclVersion === 'number' && Number.isFinite(params.aclVersion) ? params.aclVersion : 1, issuedAtMs: now, expiresAtMs: now + ttlMs, ttlMs };
    this.leases.set(leaseId, { record, warningEmittedForWindow: false });
    return { ...record };
  }

  public renewLease(leaseId: string, ttlMs: number = this.defaultTtlMs, nowMs: number = this.nowFn()): FolderAclLeaseRecord | null {
    const state = this.leases.get(leaseId);
    if (!state || state.record.revokedAtMs !== undefined) return null;
    const safeTtl = typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : this.defaultTtlMs;
    state.record.issuedAtMs = nowMs;
    state.record.ttlMs = safeTtl;
    state.record.expiresAtMs = nowMs + safeTtl;
    state.warningEmittedForWindow = false;
    return { ...state.record };
  }

  public revokeLease(leaseId: string, reason = 'ACL revoked', nowMs: number = this.nowFn()): boolean {
    const state = this.leases.get(leaseId);
    if (!state) return false;
    state.record.revokedAtMs = nowMs;
    state.record.revokedReason = reason;
    return true;
  }

  public checkExpiringLeases(nowMs: number = this.nowFn()): LeaseExpiringWarningEvent[] {
    const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? Math.floor(nowMs) : this.nowFn();
    const emittedEvents: LeaseExpiringWarningEvent[] = [];
    for (const state of this.leases.values()) {
      const { record } = state;
      if (record.revokedAtMs !== undefined || state.warningEmittedForWindow || now >= record.expiresAtMs) continue;
      const remainingMs = record.expiresAtMs - now;
      if (remainingMs <= this.warningLeadMs) {
        state.warningEmittedForWindow = true;
        const event: LeaseExpiringWarningEvent = { type: 'lease_expiring', leaseId: record.leaseId, userId: record.userId, folderId: record.folderId, roomId: record.roomId, aclVersion: record.aclVersion, expiresAtMs: record.expiresAtMs, remainingMs, emittedAtMs: now };
        emittedEvents.push(event);
        for (const listener of this.listeners) listener(event);
      }
    }
    return emittedEvents;
  }

  public getLease(leaseId: string): FolderAclLeaseRecord | undefined {
    const state = this.leases.get(leaseId);
    return state ? { ...state.record } : undefined;
  }
}

export default FolderAclLeaseManager;
