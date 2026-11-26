import { NextRequest } from 'next/server';
import { createBackupRouteHandler, type BackupStore } from '../route';

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/cron/backup-db', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/cron/backup-db', () => {
  const prevSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  afterEach(() => {
    if (prevSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = prevSecret;
    }
  });

  it('returns 401 when authorization header is missing or invalid', async () => {
    const store: BackupStore = {
      exportTables: jest.fn().mockResolvedValue({ users: [{ id: 1 }] }),
    };
    const GET = await createBackupRouteHandler(store);

    const missingRes = await GET(makeRequest());
    expect(missingRes.status).toBe(401);

    const wrongRes = await GET(makeRequest({ authorization: 'Bearer wrong-secret' }));
    expect(wrongRes.status).toBe(401);
    expect(store.exportTables).not.toHaveBeenCalled();
  });

  it('returns a timestamped backup snapshot with row counts when authorized', async () => {
    const store: BackupStore = {
      exportTables: jest.fn().mockResolvedValue({
        users: [{ id: 1 }, { id: 2 }],
        seat_holds: [{ id: 's1' }],
      }),
      saveSnapshot: jest.fn().mockResolvedValue('backups/snapshot.json'),
    };
    const GET = await createBackupRouteHandler(store);

    const res = await GET(makeRequest({ authorization: 'Bearer test-cron-secret' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.createdAt).toBeDefined();
    expect(body.summary).toEqual({ users: 2, seat_holds: 1 });
    expect(body.snapshot.tables.users.rowCount).toBe(2);
    expect(store.saveSnapshot).toHaveBeenCalledTimes(1);
  });
});