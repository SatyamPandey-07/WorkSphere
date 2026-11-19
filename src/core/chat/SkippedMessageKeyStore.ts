/**
 * SkippedMessageKeyStore.ts
 * Secure, bounded, encrypted storage and forward-secrecy lifecycle management
 * for skipped message keys in Double Ratchet sessions.
 *
 * Implements:
 * 1. Composite key indexing: (sessionId, ratchetPublicKey, sequenceCounter)
 * 2. Authenticated encryption (AES-256-GCM) with independent storage key derived via HKDF-SHA256
 * 3. Strict capacity limits: max 2,000 keys globally, max 100 keys per ratchet chain
 * 4. 7-day Forward Secrecy TTL eviction with configurable time provider
 * 5. Memory zeroization of sensitive plaintext buffers (.fill(0))
 * 6. Two-phase lease / reservation mechanism:
 *    - reserveSkippedKey: retrieves and decrypts the key and marks it leased/reserved
 *    - commitSkippedKey: permanently deletes the consumed key after successful message authentication
 *    - releaseSkippedKey: unlocks the key if message authentication fails, preserving it for legitimate packets
 * 7. Lease expiration timeout: automatically frees reserved keys if an unhandled crash or exception occurs
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "crypto";

export interface SkippedKeyMetadata {
  sessionId: string;
  ratchetPublicKeyHex: string;
  sequenceCounter: number;
  createdAt: number;
}

export interface EncryptedSkippedKeyRecord {
  metadata: SkippedKeyMetadata;
  ciphertext: string; // Hex-encoded AES-256-GCM ciphertext of 32-byte MK
  iv: string; // Hex-encoded 12-byte IV
  authTag: string; // Hex-encoded 16-byte GCM authentication tag
}

export interface SkippedKeyReservation {
  reservationId: string;
  keyId: string;
  messageKey: Buffer;
  reservedAt: number;
}

export interface SkippedKeyStoreConfig {
  sessionId: string;
  rootKey?: Buffer;
  storageKey?: Buffer;
  maxGlobalKeys?: number;
  maxKeysPerChain?: number;
  ttlMs?: number;
  leaseTtlMs?: number;
  timeProvider?: () => number;
}

export const SKIPPED_KEYS_MAX_GLOBAL = 2000;
export const SKIPPED_KEYS_MAX_PER_CHAIN = 100;
export const SKIPPED_KEYS_RETENTION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
export const SKIPPED_KEYS_LEASE_TTL_MS = 30 * 1000; // 30 seconds reservation lease

/**
 * Builds canonical composite ID for a skipped key:
 * `sessionId:ratchetPublicKeyHex:sequenceCounter`
 * Format ensures cross-session isolation and collision safety.
 */
export function buildSkippedKeyId(
  sessionId: string,
  ratchetPublicKeyHex: string,
  sequenceCounter: number,
): string {
  const normKey = ratchetPublicKeyHex.toLowerCase();
  return `${sessionId}:${normKey}:${sequenceCounter}`;
}

export class SkippedMessageKeyStore {
  private readonly sessionId: string;
  private readonly storageKey: Buffer;
  private readonly maxGlobalKeys: number;
  private readonly maxKeysPerChain: number;
  private readonly ttlMs: number;
  private readonly leaseTtlMs: number;
  private readonly timeProvider: () => number;

  // Stored records: canonical key ID -> EncryptedSkippedKeyRecord
  private readonly records: Map<string, EncryptedSkippedKeyRecord> = new Map();
  // Per-chain index: normalized ratchetPublicKeyHex -> Set of canonical key IDs
  private readonly chainIndex: Map<string, Set<string>> = new Map();

  // Active reservations: reservationId -> { keyId, reservedAt }
  private readonly reservations: Map<
    string,
    { keyId: string; reservedAt: number }
  > = new Map();
  // In-flight reserved keyIds -> reservationId
  private readonly reservedKeyIds: Map<string, string> = new Map();

  constructor(config: SkippedKeyStoreConfig) {
    this.sessionId = config.sessionId;
    this.maxGlobalKeys = config.maxGlobalKeys ?? SKIPPED_KEYS_MAX_GLOBAL;
    this.maxKeysPerChain = config.maxKeysPerChain ?? SKIPPED_KEYS_MAX_PER_CHAIN;
    this.ttlMs = config.ttlMs ?? SKIPPED_KEYS_RETENTION_TTL_MS;
    this.leaseTtlMs = config.leaseTtlMs ?? SKIPPED_KEYS_LEASE_TTL_MS;
    this.timeProvider = config.timeProvider ?? (() => Date.now());

    if (config.storageKey) {
      this.storageKey = Buffer.from(config.storageKey);
    } else if (config.rootKey) {
      // Derive independent storage key using HKDF-SHA256 from session initial root key
      const salt = Buffer.from("WorkSphere-SkippedKeyStore-v1-Salt", "utf8");
      const info = Buffer.from(
        `WorkSphere-DoubleRatchet-StorageKey:${this.sessionId}`,
        "utf8",
      );
      const derived = hkdfSync("sha256", config.rootKey, salt, info, 32);
      this.storageKey = Buffer.from(derived);
    } else {
      // Generate a fresh random 256-bit storage key
      this.storageKey = randomBytes(32);
    }
  }

  /**
   * Encrypts and inserts a skipped message key into storage.
   * Enforces per-chain and global capacity, and never stores plaintext key material.
   */
  public storeSkippedKey(
    ratchetPublicKeyHex: string,
    sequenceCounter: number,
    messageKey: Buffer,
    explicitCreatedAt?: number,
  ): void {
    if (!ratchetPublicKeyHex || typeof ratchetPublicKeyHex !== "string") {
      throw new Error("Invalid ratchet public key");
    }
    if (!Number.isSafeInteger(sequenceCounter) || sequenceCounter < 0) {
      throw new Error("Invalid sequence counter");
    }
    if (!Buffer.isBuffer(messageKey) || messageKey.length !== 32) {
      throw new Error("Message key must be a 32-byte Buffer");
    }

    const normKey = ratchetPublicKeyHex.toLowerCase();
    const id = buildSkippedKeyId(this.sessionId, normKey, sequenceCounter);

    // Evict expired keys and expired leases before capacity evaluation
    this.purgeExpired();

    // Check if key already exists (reject duplicate insertion)
    if (this.records.has(id)) {
      throw new Error(`Skipped message key already exists: ${id}`);
    }

    // Enforce per-chain capacity
    const chainSet = this.chainIndex.get(normKey) || new Set<string>();
    while (chainSet.size >= this.maxKeysPerChain) {
      const oldestChainId = this.findOldestEligibleKeyInSet(chainSet);
      if (oldestChainId) {
        this.deleteKeyInternal(oldestChainId);
      } else {
        break;
      }
    }

    // Enforce global capacity
    while (this.records.size >= this.maxGlobalKeys) {
      const oldestGlobalId = this.findOldestEligibleGlobalKey();
      if (oldestGlobalId) {
        this.deleteKeyInternal(oldestGlobalId);
      } else {
        break;
      }
    }

    const now = explicitCreatedAt ?? this.timeProvider();
    const metadata: SkippedKeyMetadata = {
      sessionId: this.sessionId,
      ratchetPublicKeyHex: normKey,
      sequenceCounter,
      createdAt: now,
    };

    // Encrypt message key with AES-256-GCM using storage key
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.storageKey, iv);
    const aad = Buffer.from(JSON.stringify(metadata), "utf8");
    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([
      cipher.update(messageKey),
      cipher.final(),
    ]).toString("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    const record: EncryptedSkippedKeyRecord = {
      metadata,
      ciphertext,
      iv: iv.toString("hex"),
      authTag,
    };

    this.records.set(id, record);

    let updatedChainSet = this.chainIndex.get(normKey);
    if (!updatedChainSet) {
      updatedChainSet = new Set<string>();
      this.chainIndex.set(normKey, updatedChainSet);
    }
    updatedChainSet.add(id);
  }

  /**
   * Checks whether an unreserved, unexpired skipped key exists.
   */
  public hasSkippedKey(
    ratchetPublicKeyHex: string,
    sequenceCounter: number,
  ): boolean {
    const normKey = ratchetPublicKeyHex.toLowerCase();
    const id = buildSkippedKeyId(this.sessionId, normKey, sequenceCounter);
    const record = this.records.get(id);
    if (!record) return false;

    const now = this.timeProvider();
    if (this.isRecordExpired(record, now)) {
      this.deleteKeyInternal(id);
      return false;
    }

    // Check if currently reserved; clean up expired reservations
    this.cleanExpiredReservations(now);
    return !this.reservedKeyIds.has(id);
  }

  /**
   * Phase 1 of consumption: Reserves and decrypts a skipped message key under an atomic lease.
   * Does NOT delete the key from storage yet.
   * If another concurrent call attempts to reserve this key, it returns null.
   */
  public reserveSkippedKey(
    ratchetPublicKeyHex: string,
    sequenceCounter: number,
  ): SkippedKeyReservation | null {
    const normKey = ratchetPublicKeyHex.toLowerCase();
    const id = buildSkippedKeyId(this.sessionId, normKey, sequenceCounter);
    const record = this.records.get(id);

    if (!record) {
      return null;
    }

    const now = this.timeProvider();
    if (this.isRecordExpired(record, now)) {
      this.deleteKeyInternal(id);
      return null;
    }

    this.cleanExpiredReservations(now);
    if (this.reservedKeyIds.has(id)) {
      // Key is currently locked/leased by another in-flight operation
      return null;
    }

    // Authenticate metadata
    if (
      record.metadata.sessionId !== this.sessionId ||
      record.metadata.ratchetPublicKeyHex !== normKey ||
      record.metadata.sequenceCounter !== sequenceCounter
    ) {
      this.deleteKeyInternal(id);
      throw new Error("Skipped key metadata authentication failed");
    }

    // Decrypt record
    let mk: Buffer;
    try {
      const iv = Buffer.from(record.iv, "hex");
      const authTag = Buffer.from(record.authTag, "hex");
      const ciphertextBuf = Buffer.from(record.ciphertext, "hex");
      const decipher = createDecipheriv("aes-256-gcm", this.storageKey, iv);
      const aad = Buffer.from(JSON.stringify(record.metadata), "utf8");
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      mk = Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]);
    } catch (err) {
      // Storage corruption or tampering: delete corrupted entry and throw
      this.deleteKeyInternal(id);
      throw new Error(
        `Failed to decrypt skipped key: ${(err as Error).message}`,
      );
    }

    if (mk.length !== 32) {
      mk.fill(0);
      this.deleteKeyInternal(id);
      throw new Error("Decrypted message key corrupted (invalid length)");
    }

    // Acquire reservation lease
    const reservationId = randomBytes(16).toString("hex");
    this.reservations.set(reservationId, { keyId: id, reservedAt: now });
    this.reservedKeyIds.set(id, reservationId);

    return {
      reservationId,
      keyId: id,
      messageKey: mk,
      reservedAt: now,
    };
  }

  /**
   * Phase 2 (Success): Permanently consumes and deletes the skipped key from storage
   * after the incoming message has been successfully authenticated and decrypted.
   */
  public commitSkippedKey(reservationId: string): void {
    const res = this.reservations.get(reservationId);
    if (!res) {
      return;
    }

    this.reservations.delete(reservationId);
    this.reservedKeyIds.delete(res.keyId);
    this.deleteKeyInternal(res.keyId);
  }

  /**
   * Phase 2 (Failure): Releases the reservation lease, unlocking the original skipped key
   * in storage so legitimate delayed messages can still be decrypted.
   */
  public releaseSkippedKey(reservationId: string): void {
    const res = this.reservations.get(reservationId);
    if (!res) {
      return;
    }

    this.reservations.delete(reservationId);
    this.reservedKeyIds.delete(res.keyId);
  }

  /**
   * Direct single-phase consumption (convenience method):
   * Reserves and immediately commits the key, returning the decrypted buffer.
   */
  public consumeSkippedKey(
    ratchetPublicKeyHex: string,
    sequenceCounter: number,
  ): Buffer | null {
    const reservation = this.reserveSkippedKey(
      ratchetPublicKeyHex,
      sequenceCounter,
    );
    if (!reservation) return null;
    this.commitSkippedKey(reservation.reservationId);
    return reservation.messageKey;
  }

  /**
   * Purges all expired keys based on TTL.
   * Returns count of purged keys.
   */
  public purgeExpired(): number {
    const now = this.timeProvider();
    this.cleanExpiredReservations(now);

    let purgedCount = 0;
    const expiredIds: string[] = [];

    for (const [id, record] of this.records.entries()) {
      if (this.isRecordExpired(record, now)) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      this.deleteKeyInternal(id);
      purgedCount++;
    }

    return purgedCount;
  }

  /**
   * Returns current count of stored skipped keys.
   */
  public get size(): number {
    return this.records.size;
  }

  /**
   * Returns current count of stored skipped keys for a given ratchet public key.
   */
  public getChainSize(ratchetPublicKeyHex: string): number {
    const normKey = ratchetPublicKeyHex.toLowerCase();
    const set = this.chainIndex.get(normKey);
    return set ? set.size : 0;
  }

  /**
   * Exports encrypted records for session persistence.
   * NEVER exports plaintext keys.
   */
  public exportEncryptedRecords(): EncryptedSkippedKeyRecord[] {
    this.purgeExpired();
    return Array.from(this.records.values());
  }

  /**
   * Imports encrypted records during session restoration.
   * Validates metadata, purges expired records, rejects corrupted records,
   * and enforces capacity limits.
   */
  public importEncryptedRecords(records: EncryptedSkippedKeyRecord[]): void {
    const now = this.timeProvider();
    for (const record of records) {
      if (
        !record ||
        !record.metadata ||
        !record.ciphertext ||
        !record.iv ||
        !record.authTag
      ) {
        continue;
      }
      if (record.metadata.sessionId !== this.sessionId) {
        // Reject records from another session
        continue;
      }
      if (this.isRecordExpired(record, now)) {
        continue;
      }

      const id = buildSkippedKeyId(
        this.sessionId,
        record.metadata.ratchetPublicKeyHex,
        record.metadata.sequenceCounter,
      );

      if (this.records.has(id)) {
        continue; // Do not duplicate
      }

      // Check per-chain capacity
      const normKey = record.metadata.ratchetPublicKeyHex.toLowerCase();
      const chainSet = this.chainIndex.get(normKey) || new Set<string>();
      if (chainSet.size >= this.maxKeysPerChain) {
        const oldestChainId = this.findOldestEligibleKeyInSet(chainSet);
        if (oldestChainId) {
          this.deleteKeyInternal(oldestChainId);
        }
      }

      // Check global capacity
      if (this.records.size >= this.maxGlobalKeys) {
        const oldestGlobalId = this.findOldestEligibleGlobalKey();
        if (oldestGlobalId) {
          this.deleteKeyInternal(oldestGlobalId);
        }
      }

      this.records.set(id, record);
      let set = this.chainIndex.get(normKey);
      if (!set) {
        set = new Set<string>();
        this.chainIndex.set(normKey, set);
      }
      set.add(id);
    }
  }

  /**
   * Destroys storage, cancels leases, and zeroizes storage key buffer.
   */
  public destroy(): void {
    this.records.clear();
    this.chainIndex.clear();
    this.reservations.clear();
    this.reservedKeyIds.clear();
    if (this.storageKey && Buffer.isBuffer(this.storageKey)) {
      this.storageKey.fill(0);
    }
  }

  private cleanExpiredReservations(now: number): void {
    const expiredResIds: string[] = [];
    for (const [resId, res] of this.reservations.entries()) {
      if (now - res.reservedAt >= this.leaseTtlMs) {
        expiredResIds.push(resId);
      }
    }
    for (const resId of expiredResIds) {
      const res = this.reservations.get(resId);
      if (res) {
        this.reservedKeyIds.delete(res.keyId);
      }
      this.reservations.delete(resId);
    }
  }

  private isRecordExpired(
    record: EncryptedSkippedKeyRecord,
    now: number,
  ): boolean {
    if (!Number.isFinite(record.metadata.createdAt)) return true;
    // Clock rollback or future timestamp anomaly: conservative handling
    if (record.metadata.createdAt > now + 60000) {
      return true;
    }
    return now - record.metadata.createdAt >= this.ttlMs;
  }

  private deleteKeyInternal(id: string): void {
    const record = this.records.get(id);
    if (!record) return;

    this.records.delete(id);
    const normKey = record.metadata.ratchetPublicKeyHex.toLowerCase();
    const set = this.chainIndex.get(normKey);
    if (set) {
      set.delete(id);
      if (set.size === 0) {
        this.chainIndex.delete(normKey);
      }
    }

    // Release any associated reservation
    const resId = this.reservedKeyIds.get(id);
    if (resId) {
      this.reservedKeyIds.delete(id);
      this.reservations.delete(resId);
    }
  }

  private findOldestEligibleKeyInSet(idSet: Set<string>): string | null {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const id of idSet) {
      // Do not evict keys that are currently leased/reserved in-flight
      if (this.reservedKeyIds.has(id)) continue;
      const record = this.records.get(id);
      if (record && record.metadata.createdAt < oldestTime) {
        oldestTime = record.metadata.createdAt;
        oldestId = id;
      }
    }
    // If all are leased (rare), fall back to any oldest
    if (!oldestId) {
      for (const id of idSet) {
        const record = this.records.get(id);
        if (record && record.metadata.createdAt < oldestTime) {
          oldestTime = record.metadata.createdAt;
          oldestId = id;
        }
      }
    }
    return oldestId;
  }

  private findOldestEligibleGlobalKey(): string | null {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, record] of this.records.entries()) {
      if (this.reservedKeyIds.has(id)) continue;
      if (record.metadata.createdAt < oldestTime) {
        oldestTime = record.metadata.createdAt;
        oldestId = id;
      }
    }
    if (!oldestId) {
      for (const [id, record] of this.records.entries()) {
        if (record.metadata.createdAt < oldestTime) {
          oldestTime = record.metadata.createdAt;
          oldestId = id;
        }
      }
    }
    return oldestId;
  }
}
