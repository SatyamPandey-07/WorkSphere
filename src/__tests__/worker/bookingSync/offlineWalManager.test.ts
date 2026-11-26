import {
  MemoryOfflineWalAdapter,
  OfflineWalManager,
} from '@/worker/bookingSync/offlineWalManager';

describe('OfflineWalManager', () => {
  it('commits atomic batches across stores and rolls back uncommitted crash transactions on recover()', async () => {
    const adapter = new MemoryOfflineWalAdapter();
    const wal = new OfflineWalManager(adapter);

    const commitRes = await wal.executeTransaction([
      {
        store: 'booking_drafts',
        type: 'PUT',
        key: 'draft-1',
        value: { venue: 'Bandra Hub', seats: 2 },
      },
      {
        store: 'seat_cache',
        type: 'PUT',
        key: 'seat-b1',
        value: { status: 'held' },
      },
    ]);
    expect(commitRes.committed).toBe(true);

    // Simulate crash before COMMIT on a second transaction
    const crashRes = await wal.executeTransaction(
      [
        {
          store: 'booking_drafts',
          type: 'PUT',
          key: 'draft-uncommitted',
          value: { venue: 'Powai Loft', seats: 5 },
        },
        {
          store: 'seat_cache',
          type: 'DELETE',
          key: 'seat-b1',
        },
      ],
      { simulateCrashBeforeCommit: true }
    );
    expect(crashRes.committed).toBe(false);

    const report = await wal.recover();
    expect(report.rolledBackTxIds).toContain(crashRes.txId);
    expect(report.stateSnapshot.booking_drafts['draft-uncommitted']).toBeUndefined();
    expect(report.stateSnapshot.seat_cache['seat-b1']).toEqual({ status: 'held' });
  });

  it('detects CRC-corrupted WAL entries cleanly and compacts entries via checkpoint()', async () => {
    const adapter = new MemoryOfflineWalAdapter();
    const wal = new OfflineWalManager(adapter);

    await wal.executeTransaction([
      { store: 'booking_drafts', type: 'PUT', key: 'd-100', value: { v: 1 } },
      { store: 'booking_drafts', type: 'PUT', key: 'd-101', value: { v: 2 } },
    ]);

    const removed = await wal.checkpoint(3);
    expect(removed).toBeGreaterThan(0);

    // Tamper with CRC of last entry
    const entries = await adapter.readEntries();
    expect(entries.length).toBeGreaterThan(0);
    entries[entries.length - 1].crc32 = (entries[entries.length - 1].crc32 ^ 0xffffffff) >>> 0;
    await adapter.writeEntries(entries);

    const recovery = await wal.recover();
    expect(recovery.truncatedCorruptedCount).toBe(1);
  });
});