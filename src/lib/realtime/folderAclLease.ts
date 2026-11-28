export type FolderAclPermission = 'read' | 'write' | 'admin';
export interface FolderAclLeaseRecord { leaseId: string; folderId: string; principalId: string; permission: FolderAclPermission; expiresAtMs: number; ttlMs: number; renewalCount: number; }
export interface FolderAclExpiringEvent { type: 'lease_expiring'; lease: FolderAclLeaseRecord; remainingMs: number; }
export type FolderAclPermissionVerifier = (params: { folderId: string; principalId: string; requiredPermission: FolderAclPermission; lease: FolderAclLeaseRecord; }) => boolean | Promise<boolean>;
export interface RenewLeaseOptions { ttlMs?: number; nowMs?: number; verifyPermission?: FolderAclPermissionVerifier; }
export interface LeaseRenewalResult { renewed: boolean; reason?: 'LEASE_NOT_FOUND' | 'PERMISSION_REVOKED' | 'LEASE_EXPIRED'; lease?: FolderAclLeaseRecord; disconnectRequired: boolean; }
export type FolderAclLeaseExpiringHandler = (event: FolderAclExpiringEvent) => void;

export class FolderAclLeaseManager { private readonly leases = new Map<string, FolderAclLeaseRecord>();
  private readonly warningTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onLeaseExpiring?: FolderAclLeaseExpiringHandler;
  private readonly warningLeadMs: number; private readonly defaultTtlMs: number; private readonly permissionVerifier?: FolderAclPermissionVerifier; constructor(
    defaultTtlMs = 60_000,
    permissionVerifier?: FolderAclPermissionVerifier,
    onLeaseExpiring?: FolderAclLeaseExpiringHandler,
    warningLeadMs = 30_000,
  ) { this.defaultTtlMs = typeof defaultTtlMs === 'number' && Number.isFinite(defaultTtlMs) && defaultTtlMs > 0 ? Math.floor(defaultTtlMs) : 60_000; this.permissionVerifier = permissionVerifier;
    this.onLeaseExpiring = onLeaseExpiring;
    this.warningLeadMs = Number.isFinite(warningLeadMs) && warningLeadMs >= 0
      ? Math.floor(warningLeadMs)
      : 30_000;
  }

  private clearWarningTimer(leaseId: string): void {
    const timer = this.warningTimers.get(leaseId);
    if (timer) clearTimeout(timer);
    this.warningTimers.delete(leaseId);
  }

  private scheduleWarning(record: FolderAclLeaseRecord): void {
    this.clearWarningTimer(record.leaseId);
    if (!this.onLeaseExpiring) return;

    const delay = Math.max(
      0,
      record.expiresAtMs - Date.now() - this.warningLeadMs,
    );

    const timer = setTimeout(() => {
      this.warningTimers.delete(record.leaseId);
      const event = this.buildExpiringEvent(record.leaseId);
      if (event) this.onLeaseExpiring?.(event);
    }, delay);

    this.warningTimers.set(record.leaseId, timer);
  }

  public revokeLease(leaseId: string): boolean {
    this.clearWarningTimer(leaseId);
    return this.leases.delete(leaseId);
  }

  public cleanup(): void {
    for (const timer of this.warningTimers.values()) clearTimeout(timer);
    this.warningTimers.clear();
    this.leases.clear();
  } public grantLease(params: { leaseId: string; folderId: string; principalId: string; permission: FolderAclPermission; ttlMs?: number; nowMs?: number; }): FolderAclLeaseRecord { const now = params.nowMs ?? Date.now(); const ttl = typeof params.ttlMs === 'number' && Number.isFinite(params.ttlMs) && params.ttlMs > 0 ? Math.floor(params.ttlMs) : this.defaultTtlMs; const record: FolderAclLeaseRecord = { leaseId: params.leaseId, folderId: params.folderId, principalId: params.principalId, permission: params.permission, expiresAtMs: now + ttl, ttlMs: ttl, renewalCount: 0 }; this.leases.set(record.leaseId, record); this.scheduleWarning(record); return { ...record }; } public getLease(leaseId: string): FolderAclLeaseRecord | undefined { const found = this.leases.get(leaseId); return found ? { ...found } : undefined; } public buildExpiringEvent(leaseId: string, nowMs = Date.now()): FolderAclExpiringEvent | null { const record = this.leases.get(leaseId); if (!record) return null; return { type: 'lease_expiring', lease: { ...record }, remainingMs: Math.max(0, record.expiresAtMs - nowMs) }; } public async handleLeaseExpiringEvent(event: FolderAclExpiringEvent, options: RenewLeaseOptions = {}): Promise<LeaseRenewalResult> { const now = options.nowMs ?? Date.now(); const existing = this.leases.get(event.lease.leaseId); if (!existing) return { renewed: false, reason: 'LEASE_NOT_FOUND', disconnectRequired: true }; if (existing.expiresAtMs <= now) { this.revokeLease(existing.leaseId); return { renewed: false, reason: 'LEASE_EXPIRED', lease: { ...existing }, disconnectRequired: true }; } const verifier = options.verifyPermission ?? this.permissionVerifier; const isPermitted = verifier ? await verifier({ folderId: existing.folderId, principalId: existing.principalId, requiredPermission: existing.permission, lease: { ...existing } }) : true; if (!isPermitted) { this.revokeLease(existing.leaseId); return { renewed: false, reason: 'PERMISSION_REVOKED', lease: { ...existing }, disconnectRequired: true }; } const nextTtl = typeof options.ttlMs === 'number' && Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? Math.floor(options.ttlMs) : existing.ttlMs; const renewedRecord: FolderAclLeaseRecord = { ...existing, ttlMs: nextTtl, expiresAtMs: now + nextTtl, renewalCount: existing.renewalCount + 1 }; this.leases.set(renewedRecord.leaseId, renewedRecord); this.scheduleWarning(renewedRecord); return { renewed: true, lease: { ...renewedRecord }, disconnectRequired: false }; } }
export default FolderAclLeaseManager;

export interface FolderAclCoordinatorLease {
  leaseId: string;
  folderId: string;
  principalId: string;
  permission: FolderAclPermission;
  expiresAtMs: number;
  ttlMs: number;
  version: number;
}

export class FolderAclCoordinator extends FolderAclLeaseManager {
  private readonly versions = new Map<string, number>();

  private versionKey(folderId: string, principalId: string): string {
    return `${folderId}::${principalId}`;
  }

  public getCurrentVersion(folderId: string, principalId: string): number {
    return this.versions.get(this.versionKey(folderId, principalId)) ?? 1;
  }

  public issueLease(params: {
    leaseId?: string;
    folderId: string;
    principalId?: string;
    userId?: string;
    permission?: FolderAclPermission;
    role?: string;
    ttlMs?: number;
    nowMs?: number;
  }): FolderAclCoordinatorLease {
    const actorId = params.principalId ?? params.userId ?? "anonymous";
    const mappedPermission: FolderAclPermission =
      params.permission ??
      (params.role === "admin" || params.role === "owner"
        ? "admin"
        : params.role === "editor" || params.role === "write"
          ? "write"
          : "read");
    const nextVersion = this.getCurrentVersion(params.folderId, actorId) + 1;
    this.versions.set(this.versionKey(params.folderId, actorId), nextVersion);
    const leaseId = params.leaseId ?? `${params.folderId}::${actorId}::${nextVersion}`;
    const granted = this.grantLease({
      leaseId,
      folderId: params.folderId,
      principalId: actorId,
      permission: mappedPermission,
      ttlMs: params.ttlMs,
      nowMs: params.nowMs,
    });
    return { ...granted, version: nextVersion };
  }
}

export const defaultFolderAclCoordinator = new FolderAclCoordinator();
