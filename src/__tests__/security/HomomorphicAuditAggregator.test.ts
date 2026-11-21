import {
  PaillierEngine,
  HomomorphicAuditAggregator,
  PaillierPublicKey,
  PaillierPrivateKey,
  gcd,
  lcm,
  modInverse,
  modPow,
} from '../../core/security/HomomorphicAuditAggregator';

describe('HomomorphicAuditAggregator & Paillier Cryptosystem', () => {
  let publicKey: PaillierPublicKey;
  let privateKey: PaillierPrivateKey;
  let aggregator: HomomorphicAuditAggregator;

  beforeAll(() => {
    // Generate standard key pair (512-bit modulus)
    const keyPair = PaillierEngine.generateStandardKeyPair();
    publicKey = keyPair.publicKey;
    privateKey = keyPair.privateKey;
    aggregator = new HomomorphicAuditAggregator(publicKey);
  });

  describe('Mathematical Modular Primitives', () => {
    it('computes greatest common divisor correctly', () => {
      expect(gcd(54n, 24n)).toBe(6n);
      expect(gcd(101n, 103n)).toBe(1n);
    });

    it('computes least common multiple correctly', () => {
      expect(lcm(12n, 18n)).toBe(36n);
      expect(lcm(7n, 13n)).toBe(91n);
    });

    it('computes modular inverse correctly using extended Euclidean algorithm', () => {
      const a = 17n;
      const m = 3120n;
      const inv = modInverse(a, m);
      expect((a * inv) % m).toBe(1n);
    });

    it('computes fast modular exponentiation', () => {
      expect(modPow(2n, 10n, 1000n)).toBe(24n);
      expect(modPow(7n, 256n, 13n)).toBe(9n);
    });
  });

  describe('Paillier Cryptosystem Core Operations', () => {
    it('encrypts and decrypts positive integers faithfully', () => {
      const plaintext = 42;
      const cipherHex = PaillierEngine.encrypt(plaintext, publicKey);
      const decrypted = PaillierEngine.decrypt(cipherHex, privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts zero', () => {
      const plaintext = 0;
      const cipherHex = PaillierEngine.encrypt(plaintext, publicKey);
      const decrypted = PaillierEngine.decrypt(cipherHex, privateKey);
      expect(decrypted).toBe(0);
    });

    it('encrypts and decrypts negative integers via two\'s complement field arithmetic', () => {
      const plaintext = -125;
      const cipherHex = PaillierEngine.encrypt(plaintext, publicKey);
      const decrypted = PaillierEngine.decrypt(cipherHex, privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('provides semantic security (IND-CPA): same plaintext yields distinct ciphertexts', () => {
      const plaintext = 100;
      const cipherA = PaillierEngine.encrypt(plaintext, publicKey);
      const cipherB = PaillierEngine.encrypt(plaintext, publicKey);
      expect(cipherA).not.toBe(cipherB);

      expect(PaillierEngine.decrypt(cipherA, privateKey)).toBe(100);
      expect(PaillierEngine.decrypt(cipherB, privateKey)).toBe(100);
    });
  });

  describe('Homomorphic Arithmetic Properties', () => {
    it('homomorphically adds two encrypted numbers', () => {
      const m1 = 450;
      const m2 = 320;
      const c1 = PaillierEngine.encrypt(m1, publicKey);
      const c2 = PaillierEngine.encrypt(m2, publicKey);

      const cSum = PaillierEngine.addCiphertexts(c1, c2, publicKey);
      const decryptedSum = PaillierEngine.decrypt(cSum, privateKey);
      expect(decryptedSum).toBe(m1 + m2);
    });

    it('homomorphically multiplies encrypted number by scalar', () => {
      const m = 35;
      const scalar = 4;
      const c = PaillierEngine.encrypt(m, publicKey);

      const cScaled = PaillierEngine.multiplyScalar(c, scalar, publicKey);
      const decryptedScaled = PaillierEngine.decrypt(cScaled, privateKey);
      expect(decryptedScaled).toBe(m * scalar);
    });

    it('homomorphically subtracts two encrypted numbers', () => {
      const m1 = 800;
      const m2 = 275;
      const c1 = PaillierEngine.encrypt(m1, publicKey);
      const c2 = PaillierEngine.encrypt(m2, publicKey);

      const cDiff = PaillierEngine.subtractCiphertexts(c1, c2, publicKey);
      const decryptedDiff = PaillierEngine.decrypt(cDiff, privateKey);
      expect(decryptedDiff).toBe(m1 - m2);
    });
  });

  describe('Enterprise Audit Batch Ingestion & Aggregation', () => {
    it('aggregates multi-contributor encrypted audit logs without revealing individual values', () => {
      // Ingest 3 contributor audit records for tenant 'corp-alpha'
      aggregator.ingestRecord({
        recordId: 'rec-001',
        contributorId: 'contributor-alice',
        tenantId: 'corp-alpha',
        timestamp: 1000,
        encryptedMetrics: {
          activeHours: PaillierEngine.encrypt(8, publicKey),
          cpuComputeMinutes: PaillierEngine.encrypt(120, publicKey),
          expenseInDollars: PaillierEngine.encrypt(45, publicKey),
        },
      });

      aggregator.ingestRecord({
        recordId: 'rec-002',
        contributorId: 'contributor-bob',
        tenantId: 'corp-alpha',
        timestamp: 1200,
        encryptedMetrics: {
          activeHours: PaillierEngine.encrypt(6, publicKey),
          cpuComputeMinutes: PaillierEngine.encrypt(90, publicKey),
          expenseInDollars: PaillierEngine.encrypt(15, publicKey),
        },
      });

      aggregator.ingestRecord({
        recordId: 'rec-003',
        contributorId: 'contributor-charlie',
        tenantId: 'corp-alpha',
        timestamp: 1500,
        encryptedMetrics: {
          activeHours: PaillierEngine.encrypt(10, publicKey),
          cpuComputeMinutes: PaillierEngine.encrypt(210, publicKey),
          expenseInDollars: PaillierEngine.encrypt(60, publicKey),
        },
      });

      // Contributor from another tenant (should NOT be aggregated into corp-alpha)
      aggregator.ingestRecord({
        recordId: 'rec-004',
        contributorId: 'contributor-dave',
        tenantId: 'corp-beta',
        timestamp: 1300,
        encryptedMetrics: {
          activeHours: PaillierEngine.encrypt(20, publicKey),
          cpuComputeMinutes: PaillierEngine.encrypt(500, publicKey),
          expenseInDollars: PaillierEngine.encrypt(200, publicKey),
        },
      });

      // Perform homomorphic batch aggregation on corp-alpha
      const batch = aggregator.aggregateBatch('batch-alpha-q1', 'corp-alpha', 900, 2000);
      expect(batch.recordCount).toBe(3);
      expect(aggregator.verifyBatchIntegrity(batch)).toBe(true);

      // Decrypt aggregate results using tenant auditor private key
      const summary = aggregator.decryptBatch(batch, privateKey);
      expect(summary.recordCount).toBe(3);
      expect(summary.metrics.activeHours).toBe(8 + 6 + 10); // 24 hours
      expect(summary.metrics.cpuComputeMinutes).toBe(120 + 90 + 210); // 420 minutes
      expect(summary.metrics.expenseInDollars).toBe(45 + 15 + 60); // $120
    });

    it('rejects malformed or out-of-range ciphertexts on ingestion', () => {
      expect(() => {
        aggregator.ingestRecord({
          recordId: 'rec-bad',
          contributorId: 'attacker',
          tenantId: 'corp-alpha',
          timestamp: 2500,
          encryptedMetrics: {
            activeHours: 'not-a-valid-hex-integer',
          },
        });
      }).toThrow();
    });
  });
});
