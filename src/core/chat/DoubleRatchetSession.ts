/**
 * DoubleRatchetSession.ts
 * Signal Protocol-compatible Double Ratchet E2EE session engine with skipped message key storage,
 * bounded capacity eviction, 7-day forward secrecy TTL, and authenticated header parsing.
 *
 * Combines Diffie-Hellman ephemeral ratchet with symmetric KDF chain ratchets,
 * providing Forward Secrecy, Post-Compromise Security, and out-of-order message caching.
 */

import {
  createECDH,
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  ECDH,
} from 'crypto';
import {
  SkippedMessageKeyStore,
  EncryptedSkippedKeyRecord,
  SKIPPED_KEYS_MAX_GLOBAL,
  SKIPPED_KEYS_MAX_PER_CHAIN,
  SKIPPED_KEYS_RETENTION_TTL_MS,
} from './SkippedMessageKeyStore';

export interface MessageHeader {
  dhPublicKey: string; // Hex-encoded public key
  pn: number;          // Previous chain message length
  n: number;           // Message index within current chain
}

export interface EncryptedMessageEnvelope {
  header: MessageHeader;
  ciphertext: string;  // Hex-encoded AES-256-GCM ciphertext
  iv: string;          // Hex-encoded 12-byte IV
  authTag: string;     // Hex-encoded 16-byte GCM authentication tag
}

export interface RatchetSessionConfig {
  sessionId: string;
  maxSkippedKeys?: number;
  maxKeysPerChain?: number;
  skippedKeyTtlMs?: number;
  timeProvider?: () => number;
  storageKey?: Buffer;
}

export interface SerializedDoubleRatchetSession {
  sessionId: string;
  localPublicKeyHex: string;
  remotePublicKeyHex: string | null;
  rkHex: string;
  cksHex: string | null;
  ckrHex: string | null;
  ns: number;
  nr: number;
  pn: number;
  skippedKeys: EncryptedSkippedKeyRecord[];
}

export class DoubleRatchetSession {
  private readonly sessionId: string;
  private readonly timeProvider: () => number;

  private dhs: ECDH;                          // Local DH key pair
  private dhr: Buffer | null = null;          // Remote DH public key
  private rk: Buffer;                         // 32-byte Root Key
  private cks: Buffer | null = null;          // Sending Chain Key
  private ckr: Buffer | null = null;          // Receiving Chain Key
  private ns: number = 0;                     // Sending message number
  private nr: number = 0;                     // Receiving message number
  private pn: number = 0;                     // Previous sending chain length

  // Dedicated encrypted skipped message key store
  private readonly skippedKeyStore: SkippedMessageKeyStore;
  private isDestroyed = false;

  constructor(config: RatchetSessionConfig, initialRootKey: Buffer) {
    this.sessionId = config.sessionId;
    this.timeProvider = config.timeProvider ?? (() => Date.now());
    this.rk = Buffer.from(initialRootKey);

    // Initialize local curve P-256 (prime256v1) key pair
    this.dhs = createECDH('prime256v1');
    this.dhs.generateKeys();

    // Initialize skipped key store
    this.skippedKeyStore = new SkippedMessageKeyStore({
      sessionId: this.sessionId,
      rootKey: this.rk,
      storageKey: config.storageKey,
      maxGlobalKeys: config.maxSkippedKeys ?? SKIPPED_KEYS_MAX_GLOBAL,
      maxKeysPerChain: config.maxKeysPerChain ?? SKIPPED_KEYS_MAX_PER_CHAIN,
      ttlMs: config.skippedKeyTtlMs ?? SKIPPED_KEYS_RETENTION_TTL_MS,
      timeProvider: this.timeProvider,
    });
  }

  // --- Session Initialization Handshakes ---

  /**
   * Initializes session for Alice (the sender/initiator).
   * Alice has Bob's pre-shared or identity DH public key.
   */
  public static initAlice(
    config: RatchetSessionConfig,
    sharedKey: Buffer,
    bobDhPublicKeyHex: string
  ): DoubleRatchetSession {
    const session = new DoubleRatchetSession(config, sharedKey);
    const bobPubKey = Buffer.from(bobDhPublicKeyHex, 'hex');
    session.dhr = bobPubKey;

    // Alice performs initial DH step with her key and Bob's key
    const dhSecret = session.dhs.computeSecret(bobPubKey);
    const [newRk, cks] = session.kdfRk(session.rk, dhSecret);
    dhSecret.fill(0);
    session.rk = newRk;
    session.cks = cks;

    return session;
  }

  /**
   * Initializes session for Bob (the receiver).
   * Bob initializes with his pre-key and waits for Alice's first message.
   */
  public static initBob(
    config: RatchetSessionConfig,
    sharedKey: Buffer,
    bobKeyPair: ECDH
  ): DoubleRatchetSession {
    const session = new DoubleRatchetSession(config, sharedKey);
    // Replace default ephemeral key with Bob's known key pair
    session.dhs = bobKeyPair;
    // Bob has no dhr or cks until Alice's first envelope arrives
    session.cks = null;
    session.ckr = null;

    return session;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getLocalPublicKeyHex(): string {
    return this.dhs.getPublicKey().toString('hex');
  }

  public getSkippedKeyStore(): SkippedMessageKeyStore {
    return this.skippedKeyStore;
  }

  // --- Ratchet Encryption ---

  /**
   * Encrypts a plaintext message under the current sending chain ratchet.
   */
  public encrypt(plaintext: string): EncryptedMessageEnvelope {
    if (this.isDestroyed) {
      throw new Error('DoubleRatchetSession has been destroyed');
    }
    if (!this.cks) {
      throw new Error('Sending chain key not established in session');
    }

    // Step sending symmetric chain KDF: MK = HMAC(CKs, "message"), next CKs = HMAC(CKs, "chain")
    const [nextCks, mk] = this.kdfCk(this.cks);
    this.cks = nextCks;

    const header: MessageHeader = {
      dhPublicKey: this.dhs.getPublicKey().toString('hex'),
      pn: this.pn,
      n: this.ns,
    };
    this.ns++;

    // Authenticated encryption with AES-256-GCM
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', mk, iv);

    // Include header as Authenticated Additional Data (AAD)
    const aad = Buffer.from(JSON.stringify(header), 'utf8');
    cipher.setAAD(aad);

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // Secure zeroization of message key buffer after encryption
    mk.fill(0);

    return {
      header,
      ciphertext,
      iv: iv.toString('hex'),
      authTag,
    };
  }

  // --- Ratchet Decryption ---

  /**
   * Decrypts an encrypted message envelope, handling asymmetric DH ratchet steps
   * and skipped message key lookups.
   */
  public decrypt(envelope: EncryptedMessageEnvelope): string {
    if (this.isDestroyed) {
      throw new Error('DoubleRatchetSession has been destroyed');
    }

    // Pure validation of incoming message envelope header
    this.validateEnvelope(envelope);

    const header = envelope.header;
    const remotePubKeyHex = header.dhPublicKey.toLowerCase();
    const remotePubKey = Buffer.from(remotePubKeyHex, 'hex');

    // 1. Check if message key was previously skipped and cached
    if (this.skippedKeyStore.hasSkippedKey(remotePubKeyHex, header.n)) {
      const reservation = this.skippedKeyStore.reserveSkippedKey(remotePubKeyHex, header.n);
      if (reservation) {
        try {
          const decrypted = this.aesGcmDecrypt(envelope, reservation.messageKey);
          // Commit and permanently delete only after successful AEAD authentication
          this.skippedKeyStore.commitSkippedKey(reservation.reservationId);
          return decrypted;
        } catch (err) {
          // Release reservation on authentication failure to preserve key for valid packet
          this.skippedKeyStore.releaseSkippedKey(reservation.reservationId);
          throw err;
        } finally {
          // Always zeroize decrypted message key buffer
          reservation.messageKey.fill(0);
        }
      }
    }

    // 2. If new remote public key received, perform DH ratchet step
    if (!this.dhr || !this.dhr.equals(remotePubKey)) {
      // Skip remaining keys in current receiving chain up to previous chain length pn
      if (this.dhr && this.ckr) {
        this.skipMessageKeys(header.pn);
      }

      this.dhRatchetStep(remotePubKey);
    }

    // 3. Skip any missed message keys in current receiving chain up to message number n
    this.skipMessageKeys(header.n);

    // 4. Derive current message key
    if (!this.ckr) {
      throw new Error('Receiving chain key uninitialized');
    }
    const [nextCkr, mk] = this.kdfCk(this.ckr);
    this.ckr = nextCkr;
    this.nr++;

    try {
      return this.aesGcmDecrypt(envelope, mk);
    } finally {
      mk.fill(0);
    }
  }

  private validateEnvelope(envelope: EncryptedMessageEnvelope): void {
    if (!envelope || !envelope.header) {
      throw new Error('Malformed envelope: missing header');
    }
    const { dhPublicKey, pn, n } = envelope.header;
    if (!dhPublicKey || typeof dhPublicKey !== 'string' || !/^[0-9a-fA-F]{64,}$/.test(dhPublicKey)) {
      throw new Error('Malformed envelope: invalid DH public key');
    }
    if (!Number.isSafeInteger(pn) || pn < 0) {
      throw new Error('Malformed envelope: invalid pn counter');
    }
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new Error('Malformed envelope: invalid n counter');
    }
    if (!envelope.ciphertext || typeof envelope.ciphertext !== 'string') {
      throw new Error('Malformed envelope: missing ciphertext');
    }
    if (!envelope.iv || typeof envelope.iv !== 'string' || envelope.iv.length !== 24) {
      throw new Error('Malformed envelope: invalid IV');
    }
    if (!envelope.authTag || typeof envelope.authTag !== 'string' || envelope.authTag.length !== 32) {
      throw new Error('Malformed envelope: invalid authTag');
    }
  }

  // --- Internal Ratchet Mechanics ---

  private dhRatchetStep(remotePubKey: Buffer): void {
    this.pn = this.ns;
    this.ns = 0;
    this.nr = 0;
    this.dhr = remotePubKey;

    // Step 1: Compute DH with our current key and their new key to update receiving chain
    const dhSecret1 = this.dhs.computeSecret(remotePubKey);
    const [rk1, ckr] = this.kdfRk(this.rk, dhSecret1);
    dhSecret1.fill(0);
    this.rk = rk1;
    this.ckr = ckr;

    // Step 2: Generate new local ephemeral DH key pair
    this.dhs = createECDH('prime256v1');
    this.dhs.generateKeys();

    // Step 3: Compute DH with our new key and their key to update sending chain
    const dhSecret2 = this.dhs.computeSecret(remotePubKey);
    const [rk2, cks] = this.kdfRk(this.rk, dhSecret2);
    dhSecret2.fill(0);
    this.rk = rk2;
    this.cks = cks;
  }

  private skipMessageKeys(untilNr: number): void {
    if (!this.dhr || !this.ckr) return;

    if (this.nr + SKIPPED_KEYS_MAX_PER_CHAIN < untilNr) {
      throw new Error('Too many missed messages to skip');
    }

    const dhrHex = this.dhr.toString('hex').toLowerCase();

    while (this.nr < untilNr) {
      const [nextCkr, mk] = this.kdfCk(this.ckr);
      this.ckr = nextCkr;

      try {
        this.skippedKeyStore.storeSkippedKey(dhrHex, this.nr, mk);
      } finally {
        mk.fill(0);
      }

      this.nr++;
    }
  }

  // --- KDF Chain Functions ---

  /**
   * Root Key KDF: derives next Root Key and Chain Key from previous Root Key and DH output.
   */
  private kdfRk(rk: Buffer, dhOut: Buffer): [Buffer, Buffer] {
    const prk = createHmac('sha256', rk).update(dhOut).digest();
    const newRk = createHmac('sha256', prk).update(Buffer.from('RootKeyNext', 'utf8')).digest();
    const newCk = createHmac('sha256', prk).update(Buffer.from('ChainKeyNext', 'utf8')).digest();
    prk.fill(0);
    return [newRk, newCk];
  }

  /**
   * Symmetric Chain KDF: derives next Chain Key and Message Key.
   */
  private kdfCk(ck: Buffer): [Buffer, Buffer] {
    const nextCk = createHmac('sha256', ck).update(Buffer.from('ChainStep', 'utf8')).digest();
    const mk = createHmac('sha256', ck).update(Buffer.from('MessageKey', 'utf8')).digest();
    return [nextCk, mk];
  }

  private aesGcmDecrypt(envelope: EncryptedMessageEnvelope, mk: Buffer): string {
    const iv = Buffer.from(envelope.iv, 'hex');
    const authTag = Buffer.from(envelope.authTag, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', mk, iv);

    const aad = Buffer.from(JSON.stringify(envelope.header), 'utf8');
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(envelope.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Explicit cleanup to purge expired skipped keys.
   */
  public purgeExpiredSkippedKeys(): number {
    return this.skippedKeyStore.purgeExpired();
  }

  /**
   * Serializes session state including encrypted skipped key records for persistent storage.
   * NEVER serializes plaintext message keys or storage encryption keys.
   */
  public serialize(): SerializedDoubleRatchetSession {
    return {
      sessionId: this.sessionId,
      localPublicKeyHex: this.getLocalPublicKeyHex(),
      remotePublicKeyHex: this.dhr ? this.dhr.toString('hex') : null,
      rkHex: this.rk.toString('hex'),
      cksHex: this.cks ? this.cks.toString('hex') : null,
      ckrHex: this.ckr ? this.ckr.toString('hex') : null,
      ns: this.ns,
      nr: this.nr,
      pn: this.pn,
      skippedKeys: this.skippedKeyStore.exportEncryptedRecords(),
    };
  }

  /**
   * Restores a session from serialized state and private key.
   * Requires an externally supplied 32-byte storage key (`options.storageKey`)
   * from a trusted key management boundary (e.g. KeyManager, WebAuthn PRF vault, or hardware enclave)
   * to decrypt retained encrypted skipped-key records.
   */
  public static restore(
    serialized: SerializedDoubleRatchetSession,
    localPrivateKeyHex: string,
    options: {
      storageKey: Buffer;
      maxSkippedKeys?: number;
      maxKeysPerChain?: number;
      skippedKeyTtlMs?: number;
      timeProvider?: () => number;
    }
  ): DoubleRatchetSession {
    if (!options || !options.storageKey) {
      throw new Error(
        'Missing required storageKey for session restoration: storage key must be provided independently by key management'
      );
    }
    if (!Buffer.isBuffer(options.storageKey) || options.storageKey.length !== 32) {
      throw new Error('Invalid storageKey: must be a 32-byte Buffer');
    }

    const rk = Buffer.from(serialized.rkHex, 'hex');
    const config: RatchetSessionConfig = {
      sessionId: serialized.sessionId,
      maxSkippedKeys: options?.maxSkippedKeys,
      maxKeysPerChain: options?.maxKeysPerChain,
      skippedKeyTtlMs: options?.skippedKeyTtlMs,
      timeProvider: options?.timeProvider,
      storageKey: options.storageKey,
    };

    const session = new DoubleRatchetSession(config, rk);

    // Restore local key pair
    const dhs = createECDH('prime256v1');
    dhs.setPrivateKey(Buffer.from(localPrivateKeyHex, 'hex'));
    session.dhs = dhs;

    if (serialized.remotePublicKeyHex) {
      session.dhr = Buffer.from(serialized.remotePublicKeyHex, 'hex');
    }
    if (serialized.cksHex) {
      session.cks = Buffer.from(serialized.cksHex, 'hex');
    }
    if (serialized.ckrHex) {
      session.ckr = Buffer.from(serialized.ckrHex, 'hex');
    }
    session.ns = serialized.ns;
    session.nr = serialized.nr;
    session.pn = serialized.pn;

    // Restore encrypted skipped keys (validates metadata and enforces TTL/capacities)
    if (serialized.skippedKeys && Array.isArray(serialized.skippedKeys)) {
      session.skippedKeyStore.importEncryptedRecords(serialized.skippedKeys);
    }

    return session;
  }

  /**
   * Securely destroys the session, zeroizing secret buffers and clearing storage.
   */
  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.rk) {
      this.rk.fill(0);
    }
    if (this.cks) {
      this.cks.fill(0);
      this.cks = null;
    }
    if (this.ckr) {
      this.ckr.fill(0);
      this.ckr = null;
    }
    this.dhr = null;

    this.skippedKeyStore.destroy();
  }
}
