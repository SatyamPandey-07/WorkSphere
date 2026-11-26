/**
 * Versioned Folder ACL Leases & Live Revocation Enforcer (#10690)
 *
 * Ensures long-lived PartyKit / multi-region collaborative sessions do not
 * retain stale write capabilities after folder membership revocation or
 * role downgrade, and fail closed when leases expire without refresh.
 */

export type AclRole = "OWNER" | "EDITOR" | "VIEWER";
export type AclOperation = "read" | "write" | "delete";

export const DEFAULT_LEASE_TTL_MS = 60_000;
export const MAX_LEASE_TTL_MS = 5 * 60_000;

export interface FolderAclLease {
  userId: string;
  folderId: string;
  role: AclRole;
  isMember: boolean;
  aclVersion: number;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface AclInvalidationEvent {
  folderId: string;
  userId: string;
  newRole: AclRole;
  isMember: boolean;
  aclVersion: number;
  revoked: boolean;
  timestampMs: number;
}

export type AclInvalidationListener = (event: AclInvalidationEvent) => void;

function keyFor(folderId: string, userId: string): string {
  return `${folderId}::${userId}`;
}

export function isOperationAllowedForRole(
  role: AclRole,
  isMember: boolean,
  operation: AclOperation,
): boolean {
  if (!isMember) return false;
  if (operation === "read") return true;
  if (operation === "write") return role === "OWNER" || role === "EDITOR";
  if (operation === "delete") return role === "OWNER";
  return false;
}

/**
 * Authoritative ACL version store and invalidation broadcaster.
 */
export class FolderAclCoordinator {
  private versions = new Map<string, number>();
  private subscribers = new Map<string, Set<AclInvalidationListener>>();

  public getCurrentVersion(folderId: string, userId: string): number {
    return this.versions.get(keyFor(folderId, userId)) ?? 1;
  }

  public issueLease(
    userId: string,
    folderId: string,
    role: AclRole,
    isMember: boolean,
    ttlMs: number = DEFAULT_LEASE_TTL_MS,
    nowMs: number = Date.now(),
  ): FolderAclLease {
    const boundedTtl = Math.max(1_000, Math.min(ttlMs, MAX_LEASE_TTL_MS));
    const aclVersion = this.getCurrentVersion(folderId, userId);
    return {
      userId,
      folderId,
      role,
      isMember,
      aclVersion,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + boundedTtl,
    };
  }

  public subscribe(
    folderId: string,
    listener: AclInvalidationListener,
  ): () => void {
    let set = this.subscribers.get(folderId);
    if (!set) {
      set = new Set();
      this.subscribers.set(folderId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  /**
   * Publishes a membership revocation or role downgrade.
   * Monotonically increments the ACL version and notifies all subscribed regions/rooms.
   */
  public publishMembershipChange(
    folderId: string,
    userId: string,
    newRole: AclRole,
    isMember: boolean,
    nowMs: number = Date.now(),
  ): AclInvalidationEvent {
    const k = keyFor(folderId, userId);
    const nextVersion = (this.versions.get(k) ?? 1) + 1;
    this.versions.set(k, nextVersion);

    const event: AclInvalidationEvent = {
      folderId,
      userId,
      newRole,
      isMember,
      aclVersion: nextVersion,
      revoked: !isMember,
      timestampMs: nowMs,
    };

    const listeners = this.subscribers.get(folderId);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }

    return event;
  }
}

/**
 * Per-region/per-server active socket lease enforcer.
 * Ignores duplicate or out-of-order invalidations and fails closed on expired leases.
 */
export class ActiveConnectionLeaseEnforcer {
  private connectionLeases = new Map<string, FolderAclLease>();
  private latestKnownVersions = new Map<string, number>();

  public registerConnection(
    connectionId: string,
    lease: FolderAclLease,
  ): void {
    const k = keyFor(lease.folderId, lease.userId);
    const knownVersion = this.latestKnownVersions.get(k) ?? 0;
    if (lease.aclVersion > knownVersion) {
      this.latestKnownVersions.set(k, lease.aclVersion);
    }
    this.connectionLeases.set(connectionId, { ...lease });
  }

  public removeConnection(connectionId: string): void {
    this.connectionLeases.delete(connectionId);
  }

  public getConnectionLease(connectionId: string): FolderAclLease | undefined {
    const lease = this.connectionLeases.get(connectionId);
    return lease ? { ...lease } : undefined;
  }

  /**
   * Applies an ACL invalidation event to all matching active connections.
   * Out-of-order or duplicate events (aclVersion <= knownVersion) are ignored
   * so stale permissions can never be restored.
   */
  public applyInvalidation(event: AclInvalidationEvent): {
    applied: boolean;
    affectedConnections: string[];
  } {
    const k = keyFor(event.folderId, event.userId);
    const knownVersion = this.latestKnownVersions.get(k) ?? 0;

    if (event.aclVersion <= knownVersion) {
      return { applied: false, affectedConnections: [] };
    }

    this.latestKnownVersions.set(k, event.aclVersion);
    const affectedConnections: string[] = [];

    for (const [connId, lease] of this.connectionLeases.entries()) {
      if (
        lease.folderId === event.folderId &&
        lease.userId === event.userId &&
        lease.aclVersion < event.aclVersion
      ) {
        lease.aclVersion = event.aclVersion;
        lease.role = event.newRole;
        lease.isMember = event.isMember && !event.revoked;
        affectedConnections.push(connId);
      }
    }

    return { applied: true, affectedConnections };
  }

  /**
   * Enforces operation-level authorization. Fails closed if the lease is
   * missing, expired, superseded by a newer ACL version, or lacks permission.
   */
  public authorizeOperation(
    connectionId: string,
    operation: AclOperation,
    nowMs: number = Date.now(),
  ): { allowed: boolean; reason?: string } {
    const lease = this.connectionLeases.get(connectionId);
    if (!lease) {
      return { allowed: false, reason: "Missing connection ACL lease" };
    }

    if (nowMs > lease.expiresAtMs) {
      return { allowed: false, reason: "ACL lease expired (fail-closed)" };
    }

    const latestVersion =
      this.latestKnownVersions.get(keyFor(lease.folderId, lease.userId)) ?? 0;
    if (lease.aclVersion < latestVersion) {
      return { allowed: false, reason: "ACL lease superseded by newer version" };
    }

    if (!isOperationAllowedForRole(lease.role, lease.isMember, operation)) {
      return {
        allowed: false,
        reason: `Operation '${operation}' denied for role '${lease.role}' (member=${lease.isMember})`,
      };
    }

    return { allowed: true };
  }
}

export const defaultFolderAclCoordinator = new FolderAclCoordinator();
