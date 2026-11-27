import { FolderAclLeaseManager, type LeaseExpiringWarningEvent } from '@/lib/realtime/folderAclLease';

describe('FolderAclLeaseManager lease_expiring warning', () => {
  it('emits lease_expiring once 30 seconds before expiry and resets on lease renewal', () => {
    let nowMs = 1_000_000;
    const warnings: LeaseExpiringWarningEvent[] = [];
    const manager = new FolderAclLeaseManager({ defaultTtlMs: 120_000, warningLeadMs: 30_000, nowFn: () => nowMs, onLeaseExpiring: (ev) => warnings.push(ev) });
    const lease = manager.issueLease({ userId: 'user-collab-1', folderId: 'folder-specs', roomId: 'room-specs', aclVersion: 3, ttlMs: 120_000, nowMs });
    expect(manager.checkExpiringLeases(nowMs + 80_000)).toHaveLength(0);
    const firstBatch = manager.checkExpiringLeases(nowMs + 90_000);
    expect(firstBatch).toHaveLength(1);
    expect(firstBatch[0]).toMatchObject({ type: 'lease_expiring', leaseId: lease.leaseId, userId: 'user-collab-1', folderId: 'folder-specs', remainingMs: 30_000 });
    expect(manager.checkExpiringLeases(nowMs + 95_000)).toHaveLength(0);
    expect(manager.checkExpiringLeases(nowMs + 110_000)).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    manager.renewLease(lease.leaseId, 120_000, nowMs + 100_000);
    const renewedWarning = manager.checkExpiringLeases(nowMs + 190_000);
    expect(renewedWarning).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });
});
