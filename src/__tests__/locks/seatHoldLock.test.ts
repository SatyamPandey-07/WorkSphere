import { SeatHoldLockManager, StaleFencingTokenError } from '../../../src/lib/locks/seatHoldLock';
import Redis from 'ioredis';
import { Pool } from 'pg';

jest.mock('ioredis');
jest.mock('pg');

describe('SeatHoldLockManager - Redlock Quorum & Fencing', () => {
  let mockRedis: jest.Mocked<Redis>;
  let mockPool: jest.Mocked<Pool>;
  let lockManager: SeatHoldLockManager;

  beforeEach(() => {
    mockRedis = new Redis() as jest.Mocked<Redis>;
    mockPool = new Pool() as jest.Mocked<Pool>;
    lockManager = new SeatHoldLockManager({
      redisClients: [mockRedis, mockRedis, mockRedis],
      pgPool: mockPool
    });
  });

  test('should calculate quorum correctly for N=3 nodes', () => {
    // @ts-ignore
    expect(lockManager.getQuorum()).toBe(2);
  });

  test('should throw StaleFencingTokenError when fencing token is older or equal', async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rowCount: 0 }),
      release: jest.fn()
    };
    // @ts-ignore
    mockPool.connect.mockResolvedValue(mockClient);

    await expect(
      lockManager.executeWithFencingToken('seat-123', 5, { status: 'HELD' })
    ).rejects.toThrow(StaleFencingTokenError);
  });
});