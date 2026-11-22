import { randomUUID } from 'crypto';

export const DEFAULT_DESK_LEASE_TTL_MS = 120_000;

export type DeskReservationStatus = 'HELD' | 'CONFIRMED' | 'RELEASED';

export interface DeskLeaseRecord {
  deskId: string;
  slotWindow: string;
  proofHash: string;
  merkleRoot: string;
  ownerToken: string;
  status: DeskReservationStatus;
  acquiredAt: number;
  expiresAt: number;
  txSignature?: string;
}

export interface RedisLikeClient {
  set(
    key: string,
    value: string,
    mode?: 'NX',
    ttlMode?: 'PX',
    ttlMs?: number
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const COMPARE_AND_RELEASE_LUA = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return 0
end
local ok, decoded = pcall(cjson.decode, raw)
if ok and decoded and decoded["ownerToken"] == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export function buildDeskLeaseKey(deskId: string, slotWindow: string): string {
  return `worksphere:desk:lease:${deskId}:${slotWindow}`;
}

export class DeskLeaseManager {
  private readonly ttlMs: number;

  constructor(
    private readonly redis: RedisLikeClient,
    options: { ttlMs?: number } = {}
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_DESK_LEASE_TTL_MS;
  }

  async acquireLease(params: {
    deskId: string;
    slotWindow: string;
    proofHash: string;
    merkleRoot: string;
    now?: number;
  }): Promise<DeskLeaseRecord | null> {
    const now = params.now ?? Date.now();
    const key = buildDeskLeaseKey(params.deskId, params.slotWindow);
    const ownerToken = randomUUID();

    const record: DeskLeaseRecord = {
      deskId: params.deskId,
      slotWindow: params.slotWindow,
      proofHash: params.proofHash,
      merkleRoot: params.merkleRoot,
      ownerToken,
      status: 'HELD',
      acquiredAt: now,
      expiresAt: now + this.ttlMs,
    };

    const setResult = await this.redis.set(
      key,
      JSON.stringify(record),
      'NX',
      'PX',
      this.ttlMs
    );

    if (setResult !== 'OK') {
      return null;
    }

    return record;
  }

  async promoteToConfirmed(params: {
    deskId: string;
    slotWindow: string;
    ownerToken: string;
    txSignature: string;
    now?: number;
  }): Promise<DeskLeaseRecord | null> {
    const now = params.now ?? Date.now();
    const key = buildDeskLeaseKey(params.deskId, params.slotWindow);
    const raw = await this.redis.get(key);
    if (!raw) return null;

    const current = JSON.parse(raw) as DeskLeaseRecord;
    if (current.ownerToken !== params.ownerToken || current.expiresAt <= now) {
      return null;
    }

    const updated: DeskLeaseRecord = {
      ...current,
      status: 'CONFIRMED',
      txSignature: params.txSignature,
    };

    const remainingMs = Math.max(1_000, current.expiresAt - now);
    await this.redis.set(key, JSON.stringify(updated), undefined, 'PX', remainingMs);
    return updated;
  }

  async releaseLease(
    deskId: string,
    slotWindow: string,
    ownerToken: string
  ): Promise<boolean> {
    const key = buildDeskLeaseKey(deskId, slotWindow);
    const deleted = await this.redis.eval(COMPARE_AND_RELEASE_LUA, [key], [ownerToken]);
    return Number(deleted) === 1;
  }
}