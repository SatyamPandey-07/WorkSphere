import { FolderAclLeaseManager } from '@/lib/realtime/folderAclLease';
describe('FolderAclLeaseManager lease_expiring renewal with ACL re-verification', () => { it('re-verifies permissions and extends TTL when access is still valid', async () => { const baseTime = 1_700_000_000_000; let verifiedCount = 0; const manager = new FolderAclLeaseManager(30_000, async ({ folderId, principalId }) => { verifiedCount += 1; return folderId === 'folder-1' && principalId === 'user-42'; }); manager.grantLease({ leaseId: 'lease-100', folderId: 'folder-1', principalId: 'user-42', permission: 'write', ttlMs: 30_000, nowMs: baseTime }); const expiringEvent = manager.buildExpiringEvent('lease-100', baseTime + 25_000); expect(expiringEvent).not.toBeNull(); expect(expiringEvent?.type).toBe('lease_expiring'); const result = await manager.handleLeaseExpiringEvent(expiringEvent!, { nowMs: baseTime + 25_000, ttlMs: 45_000 }); expect(verifiedCount).toBe(1); expect(result.renewed).toBe(true); expect(result.disconnectRequired).toBe(false); expect(result.lease?.expiresAtMs).toBe(baseTime + 25_000 + 45_000); expect(result.lease?.renewalCount).toBe(1); }); it('rejects renewal and requires disconnect when ACL permission was revoked', async () => { const baseTime = 1_700_000_000_000; let accessAllowed = true; const manager = new FolderAclLeaseManager(30_000, () => accessAllowed); manager.grantLease({ leaseId: 'lease-200', folderId: 'folder-9', principalId: 'user-99', permission: 'read', ttlMs: 30_000, nowMs: baseTime }); const expiringEvent = manager.buildExpiringEvent('lease-200', baseTime + 26_000)!; accessAllowed = false; const result = await manager.handleLeaseExpiringEvent(expiringEvent, { nowMs: baseTime + 26_000 }); expect(result.renewed).toBe(false); expect(result.reason).toBe('PERMISSION_REVOKED'); expect(result.disconnectRequired).toBe(true); expect(manager.getLease('lease-200')).toBeUndefined(); }); });


describe('FolderAclLeaseManager warning timer cleanup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears the pending warning timer when a lease is revoked', () => {
    const onLeaseExpiring = jest.fn();
    const manager = new FolderAclLeaseManager(
      60_000,
      undefined,
      onLeaseExpiring,
      30_000,
    );

    manager.grantLease({
      leaseId: 'lease-timer-1',
      folderId: 'folder-1',
      principalId: 'user-1',
      permission: 'write',
      ttlMs: 60_000,
    });

    jest.advanceTimersByTime(29_000);
    expect(onLeaseExpiring).not.toHaveBeenCalled();

    expect(manager.revokeLease('lease-timer-1')).toBe(true);
    jest.advanceTimersByTime(31_000);

    expect(onLeaseExpiring).not.toHaveBeenCalled();
    expect(manager.getLease('lease-timer-1')).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears all pending warning timers during cleanup', () => {
    const onLeaseExpiring = jest.fn();
    const manager = new FolderAclLeaseManager(
      60_000,
      undefined,
      onLeaseExpiring,
      30_000,
    );

    manager.grantLease({
      leaseId: 'lease-timer-2',
      folderId: 'folder-1',
      principalId: 'user-2',
      permission: 'read',
      ttlMs: 60_000,
    });

    manager.cleanup();
    jest.advanceTimersByTime(60_000);

    expect(onLeaseExpiring).not.toHaveBeenCalled();
    expect(manager.getLease('lease-timer-2')).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
