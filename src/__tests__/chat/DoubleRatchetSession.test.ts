import {
  DoubleRatchetSession,
  EncryptedMessageEnvelope,
} from '../../core/chat/DoubleRatchetSession';
import {
  SkippedMessageKeyStore,
  SKIPPED_KEYS_MAX_PER_CHAIN,
  SKIPPED_KEYS_RETENTION_TTL_MS,
} from '../../core/chat/SkippedMessageKeyStore';
import { createECDH, randomBytes } from 'crypto';

describe('DoubleRatchetSession & SkippedMessageKeyStore', () => {
  let alice: DoubleRatchetSession;
  let bob: DoubleRatchetSession;
  let currentTime: number;

  const fakeTimeProvider = () => currentTime;

  beforeEach(() => {
    currentTime = 1700000000000;
    const sharedSecret = randomBytes(32);

    const bobPreKey = createECDH('prime256v1');
    bobPreKey.generateKeys();
    const bobPubKeyHex = bobPreKey.getPublicKey().toString('hex');

    alice = DoubleRatchetSession.initAlice(
      {
        sessionId: 'alice-bob-session',
        timeProvider: fakeTimeProvider,
      },
      sharedSecret,
      bobPubKeyHex
    );

    bob = DoubleRatchetSession.initBob(
      {
        sessionId: 'alice-bob-session',
        timeProvider: fakeTimeProvider,
      },
      sharedSecret,
      bobPreKey
    );
  });

  afterEach(() => {
    alice.destroy();
    bob.destroy();
  });

  describe('Bidirectional Ratchet Messaging', () => {
    it('encrypts from Alice and decrypts at Bob on first transmission', () => {
      const plaintext = 'Hello Bob, this is a top-secret message.';
      const envelope = alice.encrypt(plaintext);

      expect(envelope.ciphertext).toBeDefined();
      expect(envelope.header.n).toBe(0);

      const decrypted = bob.decrypt(envelope);
      expect(decrypted).toBe(plaintext);
    });

    it('supports multiple sequential messages in the same symmetric chain', () => {
      const msg1 = 'Message one from Alice';
      const msg2 = 'Message two from Alice';
      const msg3 = 'Message three from Alice';

      const env1 = alice.encrypt(msg1);
      const env2 = alice.encrypt(msg2);
      const env3 = alice.encrypt(msg3);

      expect(env1.header.n).toBe(0);
      expect(env2.header.n).toBe(1);
      expect(env3.header.n).toBe(2);

      expect(bob.decrypt(env1)).toBe(msg1);
      expect(bob.decrypt(env2)).toBe(msg2);
      expect(bob.decrypt(env3)).toBe(msg3);
    });

    it('triggers asymmetric DH ratchet turn-around when Bob replies', () => {
      // 1. Alice -> Bob
      const envA1 = alice.encrypt('Hey Bob');
      expect(bob.decrypt(envA1)).toBe('Hey Bob');

      // 2. Bob -> Alice (triggers DH step on Bob)
      const envB1 = bob.encrypt('Hey Alice, received loud and clear');
      expect(alice.decrypt(envB1)).toBe('Hey Alice, received loud and clear');

      // 3. Alice -> Bob again (triggers DH step on Alice)
      const envA2 = alice.encrypt('Great, the ratchet is self-healing');
      expect(bob.decrypt(envA2)).toBe('Great, the ratchet is self-healing');

      // 4. Bob -> Alice again
      const envB2 = bob.encrypt('Forward secrecy guaranteed!');
      expect(alice.decrypt(envB2)).toBe('Forward secrecy guaranteed!');
    });
  });

  describe('Out-of-Order Message Caching and Single-Use Consumption', () => {
    it('buffers skipped message keys and decrypts delayed out-of-order packets', () => {
      const msg0 = 'Packet 0 (sent first, arrives last)';
      const msg1 = 'Packet 1 (sent second)';
      const msg2 = 'Packet 2 (sent third)';

      const env0 = alice.encrypt(msg0); // n = 0
      const env1 = alice.encrypt(msg1); // n = 1
      const env2 = alice.encrypt(msg2); // n = 2

      // Bob receives env1 first (skipping 0)
      expect(bob.decrypt(env1)).toBe(msg1);

      // Bob receives env2 (skipping still 0)
      expect(bob.decrypt(env2)).toBe(msg2);

      // Bob finally receives env0 (delayed packet) -> resolves from skipped keys cache!
      expect(bob.decrypt(env0)).toBe(msg0);
    });

    it('consumes skipped keys exactly once and rejects replay or duplicate consumption', () => {
      const msg0 = 'Secret packet 0';
      const msg1 = 'Secret packet 1';

      const env0 = alice.encrypt(msg0); // n = 0
      const env1 = alice.encrypt(msg1); // n = 1

      // Bob receives env1 first, skipping env0
      expect(bob.decrypt(env1)).toBe(msg1);

      // Verify skipped key for env0 is cached
      const store = bob.getSkippedKeyStore();
      expect(store.size).toBe(1);

      // Decrypt env0
      expect(bob.decrypt(env0)).toBe(msg0);

      // Key must be removed from store immediately upon consumption
      expect(store.size).toBe(0);

      // Attempting to decrypt env0 again must fail (no key available)
      expect(() => bob.decrypt(env0)).toThrow();
    });

    it('handles multiple skipped messages across DH ratchet transitions', () => {
      // Alice sends 3 messages: 0, 1, 2
      const envA0 = alice.encrypt('Alice msg 0');
      const envA1 = alice.encrypt('Alice msg 1');
      const envA2 = alice.encrypt('Alice msg 2');

      // Bob receives envA2 first -> skips 0 and 1
      expect(bob.decrypt(envA2)).toBe('Alice msg 2');
      expect(bob.getSkippedKeyStore().size).toBe(2);

      // Bob replies with 2 messages: 0, 1
      const envB0 = bob.encrypt('Bob reply 0');
      const envB1 = bob.encrypt('Bob reply 1');

      // Alice receives envB1 first -> skips 0
      expect(alice.decrypt(envB1)).toBe('Bob reply 1');
      expect(alice.getSkippedKeyStore().size).toBe(1);

      // Alice now receives envB0
      expect(alice.decrypt(envB0)).toBe('Bob reply 0');
      expect(alice.getSkippedKeyStore().size).toBe(0);

      // Bob receives envA0 and envA1
      expect(bob.decrypt(envA0)).toBe('Alice msg 0');
      expect(bob.decrypt(envA1)).toBe('Alice msg 1');
      expect(bob.getSkippedKeyStore().size).toBe(0);
    });
  });

  describe('Capacity Bounds & Eviction Policies', () => {
    it('enforces per-chain capacity limit (default 100) and evicts oldest key', () => {
      const store = new SkippedMessageKeyStore({
        sessionId: 'test-session',
        rootKey: randomBytes(32),
        maxKeysPerChain: 5,
        maxGlobalKeys: 20,
        timeProvider: fakeTimeProvider,
      });

      const chainKeyHex = '04' + 'aa'.repeat(32);

      // Store 5 keys: 0, 1, 2, 3, 4 with incrementing timestamps
      for (let i = 0; i < 5; i++) {
        currentTime += 1000;
        store.storeSkippedKey(chainKeyHex, i, randomBytes(32));
      }

      expect(store.size).toBe(5);
      expect(store.getChainSize(chainKeyHex)).toBe(5);
      expect(store.hasSkippedKey(chainKeyHex, 0)).toBe(true);

      // Store 6th key -> triggers eviction of oldest (key 0)
      currentTime += 1000;
      store.storeSkippedKey(chainKeyHex, 5, randomBytes(32));

      expect(store.size).toBe(5);
      expect(store.getChainSize(chainKeyHex)).toBe(5);
      expect(store.hasSkippedKey(chainKeyHex, 0)).toBe(false); // Evicted!
      expect(store.hasSkippedKey(chainKeyHex, 1)).toBe(true);
      expect(store.hasSkippedKey(chainKeyHex, 5)).toBe(true);
    });

    it('enforces global capacity limit (default 2,000) across multiple chains and evicts oldest global key', () => {
      const store = new SkippedMessageKeyStore({
        sessionId: 'test-session',
        rootKey: randomBytes(32),
        maxKeysPerChain: 10,
        maxGlobalKeys: 4,
        timeProvider: fakeTimeProvider,
      });

      const chain1 = '04' + '11'.repeat(32);
      const chain2 = '04' + '22'.repeat(32);

      // Chain 1: key 0 at t=1000, key 1 at t=2000
      currentTime = 1000;
      store.storeSkippedKey(chain1, 0, randomBytes(32));
      currentTime = 2000;
      store.storeSkippedKey(chain1, 1, randomBytes(32));

      // Chain 2: key 0 at t=3000, key 1 at t=4000
      currentTime = 3000;
      store.storeSkippedKey(chain2, 0, randomBytes(32));
      currentTime = 4000;
      store.storeSkippedKey(chain2, 1, randomBytes(32));

      expect(store.size).toBe(4);

      // Add key to Chain 2 at t=5000 -> global cap 4 reached -> evicts oldest global key (chain1, key 0)
      currentTime = 5000;
      store.storeSkippedKey(chain2, 2, randomBytes(32));

      expect(store.size).toBe(4);
      expect(store.hasSkippedKey(chain1, 0)).toBe(false); // Oldest global key evicted
      expect(store.hasSkippedKey(chain1, 1)).toBe(true);
      expect(store.hasSkippedKey(chain2, 0)).toBe(true);
      expect(store.hasSkippedKey(chain2, 1)).toBe(true);
      expect(store.hasSkippedKey(chain2, 2)).toBe(true);
    });

    it('rejects skipping more than SKIPPED_KEYS_MAX_PER_CHAIN messages in a single step', () => {
      const longJumpEnv: EncryptedMessageEnvelope = {
        header: {
          dhPublicKey: alice.getLocalPublicKeyHex(),
          pn: 0,
          n: SKIPPED_KEYS_MAX_PER_CHAIN + 1, // Exceeds per-chain limit
        },
        ciphertext: 'deadbeef',
        iv: '01'.repeat(12),
        authTag: '02'.repeat(16),
      };

      expect(() => {
        bob.decrypt(longJumpEnv);
      }).toThrow('Too many missed messages to skip');
    });
  });

  describe('Seven-Day Forward Secrecy TTL & Eviction', () => {
    it('allows decryption of delayed message within 7-day retention window', () => {
      const msg0 = 'Packet within 7 days';
      const msg1 = 'Packet triggering skip';

      const env0 = alice.encrypt(msg0);
      const env1 = alice.encrypt(msg1);

      // Bob decrypts msg1, skipping msg0
      expect(bob.decrypt(env1)).toBe(msg1);

      // Advance clock by 6 days, 23 hours (within 7 days)
      currentTime += 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000;

      // Delayed message must still decrypt successfully
      expect(bob.decrypt(env0)).toBe(msg0);
    });

    it('expires and purges skipped message keys after 7 days', () => {
      const msg0 = 'Packet expiring';
      const msg1 = 'Packet triggering skip';

      const env0 = alice.encrypt(msg0);
      const env1 = alice.encrypt(msg1);

      expect(bob.decrypt(env1)).toBe(msg1);

      // Advance clock past 7 days
      currentTime += SKIPPED_KEYS_RETENTION_TTL_MS + 1000;

      // Has skipped key should report false and delete expired key
      const store = bob.getSkippedKeyStore();
      expect(store.hasSkippedKey(env0.header.dhPublicKey, 0)).toBe(false);
      expect(store.size).toBe(0);

      // Decryption of expired packet must fail
      expect(() => bob.decrypt(env0)).toThrow();
    });

    it('purgeExpired removes all expired records and is idempotent', () => {
      const store = new SkippedMessageKeyStore({
        sessionId: 'test-session',
        rootKey: randomBytes(32),
        timeProvider: fakeTimeProvider,
      });

      const chainHex = '04' + 'bb'.repeat(32);
      store.storeSkippedKey(chainHex, 0, randomBytes(32));

      currentTime += SKIPPED_KEYS_RETENTION_TTL_MS + 5000;
      store.storeSkippedKey(chainHex, 1, randomBytes(32)); // New valid key

      expect(store.size).toBe(1); // Key 0 purged upon insert of Key 1
      expect(store.hasSkippedKey(chainHex, 0)).toBe(false);
      expect(store.hasSkippedKey(chainHex, 1)).toBe(true);

      expect(store.purgeExpired()).toBe(0);
    });
  });

  describe('Secure Zeroization', () => {
    it('zeroizes the caller message key buffer in storeSkippedKey', () => {
      const store = new SkippedMessageKeyStore({
        sessionId: 'test-session',
        rootKey: randomBytes(32),
        timeProvider: fakeTimeProvider,
      });

      const chainHex = '04' + 'cc'.repeat(32);
      const mk = Buffer.from('aa'.repeat(32), 'hex');
      expect(mk.equals(Buffer.alloc(32, 0))).toBe(false);

      store.storeSkippedKey(chainHex, 0, mk);
      // Retrieve key and verify it can be consumed and zeroized
      const retrieved = store.consumeSkippedKey(chainHex, 0)!;
      expect(retrieved.length).toBe(32);
      retrieved.fill(0);
      expect(retrieved.equals(Buffer.alloc(32, 0))).toBe(true);
    });

    it('zeroizes session root key and chain keys upon destroy', () => {
      alice.encrypt('Testing session destroy');
      alice.destroy();

      expect(() => alice.encrypt('Should fail after destroy')).toThrow(
        'DoubleRatchetSession has been destroyed'
      );
    });
  });

  describe('Encrypted Storage & Session Persistence', () => {
    it('persists skipped keys encrypted and never exposes plaintext or storageKey in serialized data', () => {
      const msg0 = 'Secret out of order';
      const msg1 = 'Secret in order';

      alice.encrypt(msg0);
      const env1 = alice.encrypt(msg1);

      bob.decrypt(env1); // skips msg0

      const serialized = bob.serialize();
      expect(serialized.skippedKeys.length).toBe(1);

      // Verify storageKeyHex is NOT present in serialized output
      expect((serialized as any).storageKeyHex).toBeUndefined();

      const record = serialized.skippedKeys[0];
      expect(record.ciphertext).toBeDefined();
      expect(record.iv).toHaveLength(24); // 12 bytes hex
      expect(record.authTag).toHaveLength(32); // 16 bytes hex

      // Ensure plaintext does not appear anywhere in serialized output
      const json = JSON.stringify(serialized);
      expect(json.includes(msg0)).toBe(false);
      expect(json.includes('storageKeyHex')).toBe(false);
    });

    it('restores session and allows out-of-order decryption from restored encrypted skipped keys with external storage key', () => {
      // Bob PreKey
      const bobPreKey = createECDH('prime256v1');
      bobPreKey.generateKeys();
      const bobPrivHex = bobPreKey.getPrivateKey().toString('hex');
      const bobPubHex = bobPreKey.getPublicKey().toString('hex');

      const sharedSecret = randomBytes(32);
      // Independent external storage key from caller's key manager
      const externalStorageKey = randomBytes(32);

      const senderAlice = DoubleRatchetSession.initAlice(
        { sessionId: 'persist-session', timeProvider: fakeTimeProvider },
        sharedSecret,
        bobPubHex
      );

      const receiverBob = DoubleRatchetSession.initBob(
        {
          sessionId: 'persist-session',
          timeProvider: fakeTimeProvider,
          storageKey: externalStorageKey,
        },
        sharedSecret,
        bobPreKey
      );

      const env0 = senderAlice.encrypt('Delayed payload 0');
      const env1 = senderAlice.encrypt('Immediate payload 1');

      // Bob decrypts env1 -> env0 is skipped and saved in encrypted storage
      expect(receiverBob.decrypt(env1)).toBe('Immediate payload 1');

      // Serialize Bob's session
      const serializedBob = receiverBob.serialize();
      expect((serializedBob as any).storageKeyHex).toBeUndefined();
      receiverBob.destroy();

      // Test 1: Restoration fails if storageKey is missing
      expect(() => {
        DoubleRatchetSession.restore(serializedBob, bobPrivHex, undefined as any);
      }).toThrow('Missing required storageKey');

      // Test 2: Restoration fails if storageKey has invalid length
      expect(() => {
        DoubleRatchetSession.restore(serializedBob, bobPrivHex, {
          storageKey: Buffer.from('too-short'),
        });
      }).toThrow('Invalid storageKey: must be a 32-byte Buffer');

      // Test 3: Restoration with wrong storage key fails to decrypt delayed message
      const wrongStorageKey = randomBytes(32);
      const wrongRestoredBob = DoubleRatchetSession.restore(serializedBob, bobPrivHex, {
        storageKey: wrongStorageKey,
        timeProvider: fakeTimeProvider,
      });
      expect(() => wrongRestoredBob.decrypt(env0)).toThrow('Failed to decrypt skipped key');
      wrongRestoredBob.destroy();

      // Test 4: Restore Bob with correct storage key
      const restoredBob = DoubleRatchetSession.restore(serializedBob, bobPrivHex, {
        storageKey: externalStorageKey,
        timeProvider: fakeTimeProvider,
      });

      // Decrypt delayed message on restored session!
      expect(restoredBob.decrypt(env0)).toBe('Delayed payload 0');
      restoredBob.destroy();
      senderAlice.destroy();
    });

    it('rejects tampered ciphertext or metadata in skipped key store', () => {
      const store = new SkippedMessageKeyStore({
        sessionId: 'tamper-test',
        rootKey: randomBytes(32),
        timeProvider: fakeTimeProvider,
      });

      const chainHex = '04' + 'ee'.repeat(32);
      store.storeSkippedKey(chainHex, 0, randomBytes(32));

      const records = store.exportEncryptedRecords();
      // Tamper ciphertext
      records[0].ciphertext = 'ff' + records[0].ciphertext.slice(2);

      const tamperedStore = new SkippedMessageKeyStore({
        sessionId: 'tamper-test',
        rootKey: randomBytes(32),
        timeProvider: fakeTimeProvider,
      });
      tamperedStore.importEncryptedRecords(records);

      expect(() => {
        tamperedStore.consumeSkippedKey(chainHex, 0);
      }).toThrow('Failed to decrypt skipped key');
    });
  });

  describe('Tamper Resistance & Authentication', () => {
    it('preserves skipped keys when forged ciphertext fails AEAD authentication, and decrypts legitimate delayed message', () => {
      const msg0 = 'Legitimate delayed secret 0';
      const msg1 = 'Immediate message 1';

      const env0 = alice.encrypt(msg0); // n = 0
      const env1 = alice.encrypt(msg1); // n = 1

      // Bob receives env1 -> skips n = 0
      expect(bob.decrypt(env1)).toBe(msg1);

      // Verify key for n = 0 is cached in storage
      expect(bob.getSkippedKeyStore().size).toBe(1);

      // Attacker sends forged envelope with matching header (same pubKey and n = 0)
      const forgedEnv: EncryptedMessageEnvelope = {
        header: { ...env0.header },
        ciphertext: 'deadbeef'.repeat(8),
        iv: env0.iv,
        authTag: 'beefcafe'.repeat(4), // invalid tag
      };

      // Decryption of forged message must fail AEAD verification
      expect(() => bob.decrypt(forgedEnv)).toThrow();

      // Crucial: Skipped key must NOT be deleted by the failed forged attempt!
      expect(bob.getSkippedKeyStore().size).toBe(1);

      // Legitimate delayed message env0 arrives and decrypts successfully!
      expect(bob.decrypt(env0)).toBe(msg0);

      // Now consumed: key must be permanently removed
      expect(bob.getSkippedKeyStore().size).toBe(0);

      // Replaying env0 must fail now that key is consumed
      expect(() => bob.decrypt(env0)).toThrow();
    });

    it('preserves skipped-key access across multiple DH ratchet transitions and session restoration', () => {
      // 1. Alice sends messages 0 and 1
      const envA0 = alice.encrypt('Alice delayed 0');
      const envA1 = alice.encrypt('Alice prompt 1');

      // Bob receives envA1, skipping envA0 (chain 1)
      expect(bob.decrypt(envA1)).toBe('Alice prompt 1');
      expect(bob.getSkippedKeyStore().size).toBe(1);

      // 2. Bob replies -> triggers DH ratchet step 1
      const envB0 = bob.encrypt('Bob reply 0');
      expect(alice.decrypt(envB0)).toBe('Bob reply 0');

      // 3. Alice replies -> triggers DH ratchet step 2 (Alice new DH key)
      const envA2_0 = alice.encrypt('Alice delayed in chain 2 (msg 0)');
      const envA2_1 = alice.encrypt('Alice prompt in chain 2 (msg 1)');

      // Bob receives envA2_1, skipping envA2_0
      expect(bob.decrypt(envA2_1)).toBe('Alice prompt in chain 2 (msg 1)');
      // Now Bob has 2 skipped keys from two different ratchet chains!
      expect(bob.getSkippedKeyStore().size).toBe(2);

      // 4. Bob serializes session state (root key has advanced multiple times)
      const serializedBob = bob.serialize();
      expect((serializedBob as any).storageKeyHex).toBeUndefined();

      // 5. Restore Bob in fresh instance with Bob's storage key
      // Get Bob's current private key hex from bob instance
      const bobPrivHex = (bob as any).dhs.getPrivateKey().toString('hex');
      const bobStorageKey = (bob.getSkippedKeyStore() as any).storageKey;
      const restoredBob = DoubleRatchetSession.restore(serializedBob, bobPrivHex, {
        storageKey: bobStorageKey,
        timeProvider: fakeTimeProvider,
      });

      // Both skipped keys from older and newer chains must still decrypt successfully!
      expect(restoredBob.decrypt(envA0)).toBe('Alice delayed 0');
      expect(restoredBob.decrypt(envA2_0)).toBe('Alice delayed in chain 2 (msg 0)');

      expect(restoredBob.getSkippedKeyStore().size).toBe(0);
      restoredBob.destroy();
    });

    it('rejects tampered ciphertexts with authentication tag mismatch', () => {
      const envelope = alice.encrypt('Secret payload');

      // Tamper ciphertext
      const tamperedCiphertext = 'ff' + envelope.ciphertext.slice(2);
      const tamperedEnvelope: EncryptedMessageEnvelope = {
        ...envelope,
        ciphertext: tamperedCiphertext,
      };

      expect(() => {
        bob.decrypt(tamperedEnvelope);
      }).toThrow();
    });

    it('rejects tampered header metadata (AAD integrity violation)', () => {
      const envelope = alice.encrypt('Secret payload');

      // Tamper header message number
      const tamperedEnvelope: EncryptedMessageEnvelope = {
        ...envelope,
        header: {
          ...envelope.header,
          n: envelope.header.n + 1,
        },
      };

      expect(() => {
        bob.decrypt(tamperedEnvelope);
      }).toThrow();
    });

    it('rejects malformed header structures safely without session state corruption', () => {
      const malformed: any = {
        header: {
          dhPublicKey: 'not-hex',
          pn: -1,
          n: 0,
        },
        ciphertext: 'abcd',
        iv: '1234',
        authTag: '5678',
      };

      expect(() => {
        bob.decrypt(malformed);
      }).toThrow('Malformed envelope: invalid DH public key');

      // Next valid message from Alice still succeeds without lockout
      const validEnv = alice.encrypt('Valid follow-up message');
      expect(bob.decrypt(validEnv)).toBe('Valid follow-up message');
    });
  });
});
