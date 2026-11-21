import { NextRequest, NextResponse } from 'next/server';

export interface BackupSnapshot {
  createdAt: string;
  driver: 'postgres' | 'sqlite';
  tables: Record<string, { rowCount: number; rows: Record<string, unknown>[] }>;
}

export interface BackupStore {
  exportTables(): Promise<Record<string, Record<string, unknown>[]>>;
  saveSnapshot?(snapshot: BackupSnapshot): Promise<string | void>;
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;

  const [scheme, token] = authHeader.trim().split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token === secret;
}

export async function createBackupRouteHandler(store: BackupStore) {
  return async function GET(req: NextRequest) {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const rawTables = await store.exportTables();
      const driver: 'postgres' | 'sqlite' = process.env.DATABASE_URL?.startsWith('postgres')
        ? 'postgres'
        : 'sqlite';

      const tables: BackupSnapshot['tables'] = {};
      for (const [name, rows] of Object.entries(rawTables)) {
        tables[name] = {
          rowCount: rows.length,
          rows,
        };
      }

      const snapshot: BackupSnapshot = {
        createdAt: new Date().toISOString(),
        driver,
        tables,
      };

      const location = store.saveSnapshot ? await store.saveSnapshot(snapshot) : undefined;

      return NextResponse.json(
        {
          ok: true,
          createdAt: snapshot.createdAt,
          driver: snapshot.driver,
          location: location ?? null,
          summary: Object.fromEntries(
            Object.entries(tables).map(([table, info]) => [table, info.rowCount])
          ),
          snapshot,
        },
        { status: 200 }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Backup failed';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

const defaultStore: BackupStore = {
  async exportTables() {
    return {};
  },
};

export const GET = createBackupRouteHandler(defaultStore);