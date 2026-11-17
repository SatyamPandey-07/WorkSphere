import Redis from 'ioredis';
import { Pool } from 'pg';
import crypto from 'crypto';

export interface RedlockOptions {
  redisClients: Redis[];
  pgPool: Pool;
  retryCount?: number;
  retryDelayMin?: number;
  retryDelayMax?: number;
  driftFactor?: number;
}

export class StaleFencingTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleFencingTokenError';
  }
}

export class SeatHoldLockManager {
  private redisClients: Redis[];
  private pgPool: Pool;
  private retryCount: number;
  private retryDelayMin: number;
  private retryDelayMax: number;
  private driftFactor: number;

  constructor(options: RedlockOptions) {
    if (!options.redisClients || options.redisClients.length === 0) {
      throw new Error('Redlock requires at least one Redis client/node.');
    }
    this.redisClients = options.redisClients;
    this.pgPool = options.pgPool;
    this.retryCount = options.retryCount ?? 3;
    this.retryDelayMin = options.retryDelayMin ?? 200;
    this.retryDelayMax = options.retryDelayMax ?? 400;
    this.driftFactor = options.driftFactor ?? 0.01;
  }

  private getQuorum(): number {
    return Math.floor(this.redisClients.length / 2) + 1;
  }

  async acquireLock(resourceKey: string, ttlMs: number): Promise<{ lockValue: string; validityTime: number; fencingToken: number } | null> {
    const lockValue = crypto.randomBytes(16).toString('hex');
    const quorum = this.getQuorum();

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      const startTime = Date.now();
      let successCount = 0;

      const acquisitionPromises = this.redisClients.map(async (client) => {
        try {
          const res = await client.set(resourceKey, lockValue, 'PX', ttlMs, 'NX');
          return res === 'OK';
        } catch {
          return false;
        }
      });

      const results = await Promise.all(acquisitionPromises);
      successCount = results.filter(Boolean).length;

      const elapsedTime = Date.now() - startTime;
      const clockDrift = Math.floor(ttlMs * this.driftFactor) + 2;
      const validityTime = ttlMs - elapsedTime - clockDrift;

      if (successCount >= quorum && validityTime > 0) {
        const fencingToken = await this.incrementAndGetFencingToken(resourceKey);
        return { lockValue, validityTime, fencingToken };
      }

      await this.releaseLock(resourceKey, lockValue);
      const delay = Math.random() * (this.retryDelayMax - this.retryDelayMin) + this.retryDelayMin;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return null;
  }

  private async incrementAndGetFencingToken(resourceKey: string): Promise<number> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      const updateRes = await client.query(
        `INSERT INTO lock_fencing_counters (resource_key, fencing_token, updated_at)
         VALUES ($1, 1, NOW())
         ON CONFLICT (resource_key)
         DO UPDATE SET fencing_token = lock_fencing_counters.fencing_token + 1, updated_at = NOW()
         RETURNING fencing_token`,
        [resourceKey]
      );
      const token = updateRes.rows[0].fencing_token;
      await client.query('COMMIT');
      return token;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async executeWithFencingToken(seatId: string, fencingToken: number, seatData: any): Promise<boolean> {
    const client = await this.pgPool.connect();
    try {
      const res = await client.query(
        `UPDATE seat_allocations
         SET status = $1, fencing_token = $2, updated_at = NOW()
         WHERE seat_id = $3 AND (fencing_token IS NULL OR $2 > fencing_token)`,
        [seatData.status, fencingToken, seatId]
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new StaleFencingTokenError(`Stale fencing token ${fencingToken} rejected for seat ${seatId}`);
      }
      return true;
    } finally {
      client.release();
    }
  }

  async releaseLock(resourceKey: string, lockValue: string): Promise<void> {
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await Promise.all(
      this.redisClients.map(async (client) => {
        try {
          await client.eval(luaScript, 1, resourceKey, lockValue);
        } catch {}
      })
    );
  }
}