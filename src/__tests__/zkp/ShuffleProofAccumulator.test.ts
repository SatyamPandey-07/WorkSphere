import {
  ShuffleProofAccumulator,
  ShuffleFieldMath,
  SHUFFLE_PRIME,
  ElGamalCiphertext,
} from '../../core/zkp/ShuffleProofAccumulator';

describe('ShuffleProofAccumulator', () => {
  let accumulator: ShuffleProofAccumulator;

  beforeEach(() => {
    accumulator = new ShuffleProofAccumulator();
  });

  describe('Field Math & Cryptographic Primitives', () => {
    it('performs modular arithmetic mod SHUFFLE_PRIME correctly', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      const addRes = ShuffleFieldMath.add(a, b);
      expect(addRes).toBe((a + b) % SHUFFLE_PRIME);

      const subRes = ShuffleFieldMath.sub(a, b);
      const expectedSub = (a - b) % SHUFFLE_PRIME + SHUFFLE_PRIME;
      expect(subRes).toBe(expectedSub % SHUFFLE_PRIME);

      const mulRes = ShuffleFieldMath.mul(a, b);
      expect(mulRes).toBe((a * b) % SHUFFLE_PRIME);
    });

    it('computes modular exponentiation and inversion correctly', () => {
      const val = 42424242424242n;
      const inv = ShuffleFieldMath.inv(val);
      const identity = ShuffleFieldMath.mul(val, inv);
      expect(identity).toBe(1n);

      expect(() => ShuffleFieldMath.inv(0n)).toThrow('Cannot invert zero');
    });

    it('generates random scalar and hashes to scalar within field bounds', () => {
      const s1 = ShuffleFieldMath.randomScalar();
      expect(s1 > 0n && s1 < SHUFFLE_PRIME).toBe(true);

      const h1 = ShuffleFieldMath.hashToScalar('test-input');
      const h2 = ShuffleFieldMath.hashToScalar('test-input');
      expect(h1).toBe(h2);
      expect(h1 > 0n && h1 < SHUFFLE_PRIME).toBe(true);
    });
  });

  describe('Homomorphic ElGamal Encryption & Rerandomization', () => {
    it('encrypts and decrypts plaintexts accurately', () => {
      const keypair = accumulator.generateKeypair();
      const message = 1337n;

      const ct = accumulator.encrypt(message, keypair.publicKey);
      const decrypted = accumulator.decrypt(ct, keypair.privateKey);
      expect(decrypted).toBe(message);
    });

    it('re-randomizes ciphertexts preserving original decryption', () => {
      const keypair = accumulator.generateKeypair();
      const message = 999999n;

      const ct1 = accumulator.encrypt(message, keypair.publicKey);
      const ct2 = accumulator.reencrypt(ct1, keypair.publicKey);

      // Ciphertext components must differ due to fresh randomness
      expect(ct1.c1 !== ct2.c1 || ct1.c2 !== ct2.c2).toBe(true);

      // Decryption of both must yield identical plaintext
      const dec1 = accumulator.decrypt(ct1, keypair.privateKey);
      const dec2 = accumulator.decrypt(ct2, keypair.privateKey);
      expect(dec1).toBe(message);
      expect(dec2).toBe(message);
    });
  });

  describe('Shuffle Proof Generation & Verification', () => {
    it('creates and verifies a valid verifiable mixnet shuffle', () => {
      const keypair = accumulator.generateKeypair();
      const messages = [101n, 202n, 303n, 404n];
      const inputs: ElGamalCiphertext[] = messages.map(m => accumulator.encrypt(m, keypair.publicKey));

      const permutation = [2, 0, 3, 1]; // Valid bijection
      const { shuffledCiphertexts, proof } = accumulator.createShuffle(
        inputs,
        permutation,
        keypair.publicKey,
        'mixnode-alpha',
        0
      );

      expect(shuffledCiphertexts.length).toBe(inputs.length);
      expect(proof.metadata.mixnodeId).toBe('mixnode-alpha');

      // Verify the shuffle
      const res = accumulator.verifyShuffle(inputs, shuffledCiphertexts, keypair.publicKey, proof);
      expect(res.valid).toBe(true);
      expect(res.accumulatedProductValid).toBe(true);

      // Verify decrypted plaintexts match permuted set
      const decryptedShuffled = shuffledCiphertexts.map(ct => accumulator.decrypt(ct, keypair.privateKey));
      const expectedPlaintexts = permutation.map(idx => messages[idx]);
      expect(decryptedShuffled).toEqual(expectedPlaintexts);
    });

    it('rejects invalid permutations and mismatched inputs', () => {
      const keypair = accumulator.generateKeypair();
      const inputs = [accumulator.encrypt(1n, keypair.publicKey), accumulator.encrypt(2n, keypair.publicKey)];

      // Duplicated index
      expect(() =>
        accumulator.createShuffle(inputs, [0, 0], keypair.publicKey, 'node-1')
      ).toThrow('Invalid permutation');

      // Length mismatch
      expect(() =>
        accumulator.createShuffle(inputs, [0], keypair.publicKey, 'node-1')
      ).toThrow('Permutation length 1 must match input length 2');
    });

    it('rejects tampered ciphertexts or forged proofs', () => {
      const keypair = accumulator.generateKeypair();
      const inputs = [accumulator.encrypt(10n, keypair.publicKey), accumulator.encrypt(20n, keypair.publicKey)];
      const permutation = [1, 0];

      const { shuffledCiphertexts, proof } = accumulator.createShuffle(
        inputs,
        permutation,
        keypair.publicKey,
        'mixnode-beta',
        0
      );

      // Tamper with shuffled ciphertext
      const tamperedOutputs = [...shuffledCiphertexts];
      tamperedOutputs[0] = { ...tamperedOutputs[0], c2: tamperedOutputs[0].c2 + 1n };

      const tamperRes = accumulator.verifyShuffle(inputs, tamperedOutputs, keypair.publicKey, proof);
      expect(tamperRes.valid).toBe(false);

      // Tamper with proof challenge
      const forgedProof = { ...proof, challenge: proof.challenge + 1n };
      const forgeRes = accumulator.verifyShuffle(inputs, shuffledCiphertexts, keypair.publicKey, forgedProof);
      expect(forgeRes.valid).toBe(false);
      expect(forgeRes.reason).toContain('challenge mismatch');
    });
  });

  describe('Multi-Party Mixnet Accumulation & Batch Verification', () => {
    it('accumulates multiple mixnet layers and batch verifies the chain', () => {
      const keypair = accumulator.generateKeypair();
      const inputs = [
        accumulator.encrypt(10n, keypair.publicKey),
        accumulator.encrypt(20n, keypair.publicKey),
        accumulator.encrypt(30n, keypair.publicKey),
      ];

      // Layer 0: Mixnode 1
      const perm1 = [1, 2, 0];
      const layer1 = accumulator.createShuffle(inputs, perm1, keypair.publicKey, 'node-1', 0);
      const acc1 = accumulator.accumulateLayer(inputs, layer1.shuffledCiphertexts, keypair.publicKey, layer1.proof);
      expect(acc1.success).toBe(true);

      // Layer 1: Mixnode 2
      const perm2 = [2, 0, 1];
      const layer2 = accumulator.createShuffle(
        layer1.shuffledCiphertexts,
        perm2,
        keypair.publicKey,
        'node-2',
        1
      );
      const acc2 = accumulator.accumulateLayer(
        layer1.shuffledCiphertexts,
        layer2.shuffledCiphertexts,
        keypair.publicKey,
        layer2.proof
      );
      expect(acc2.success).toBe(true);

      expect(accumulator.getLayers().length).toBe(2);

      // Batch verification of whole pipeline
      const batchRes = accumulator.verifyBatch(inputs, keypair.publicKey);
      expect(batchRes.valid).toBe(true);
      expect(batchRes.verifiedLayersCount).toBe(2);
      expect(batchRes.errors.length).toBe(0);

      // Clearing accumulator
      accumulator.clear();
      expect(accumulator.getLayers().length).toBe(0);
    });
  });
});
