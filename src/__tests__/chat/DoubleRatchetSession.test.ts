import {
  DoubleRatchetSession,
  EncryptedMessageEnvelope,
} from '../../core/chat/DoubleRatchetSession';
import { createECDH, randomBytes } from 'crypto';

describe('DoubleRatchetSession', () => {
  let alice: DoubleRatchetSession;
  let bob: DoubleRatchetSession;

  beforeEach(() => {
    // Generate initial shared secret (from X3DH handshake or pre-shared root key)
    const sharedSecret = randomBytes(32);

    // Bob creates initial pre-key pair
    const bobPreKey = createECDH('prime256v1');
    bobPreKey.generateKeys();
    const bobPubKeyHex = bobPreKey.getPublicKey().toString('hex');

    // Alice initializes with Bob's public key
    alice = DoubleRatchetSession.initAlice(
      { sessionId: 'alice-bob-session' },
      sharedSecret,
      bobPubKeyHex
    );

    // Bob initializes with his pre-key
    bob = DoubleRatchetSession.initBob(
      { sessionId: 'alice-bob-session' },
      sharedSecret,
      bobPreKey
    );
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

  describe('Out-of-Order Message Caching', () => {
    it('buffers skipped message keys and decrypts delayed out-of-order packets', () => {
      const msg1 = 'Packet 1 (sent first, arrives last)';
      const msg2 = 'Packet 2 (sent second)';
      const msg3 = 'Packet 3 (sent third)';

      const env1 = alice.encrypt(msg1); // n = 0
      const env2 = alice.encrypt(msg2); // n = 1
      const env3 = alice.encrypt(msg3); // n = 2

      // Bob receives env2 first (skipping 0)
      expect(bob.decrypt(env2)).toBe(msg2);

      // Bob receives env3 (skipping still 0)
      expect(bob.decrypt(env3)).toBe(msg3);

      // Bob finally receives env1 (delayed packet) -> resolves from skipped keys cache!
      expect(bob.decrypt(env1)).toBe(msg1);
    });
  });

  describe('Tamper Resistance & Authentication', () => {
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
  });
});
