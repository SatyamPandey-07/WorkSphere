import {
  RangePartitionProver,
  PartitionFieldMath,
  PARTITION_PRIME,
} from '../../core/zkp/RangePartitionProver';

describe('RangePartitionProver', () => {
  let prover: RangePartitionProver;

  beforeEach(() => {
    prover = new RangePartitionProver();
  });

  describe('Field Math & Radix Decomposition', () => {
    it('performs modular arithmetic mod PARTITION_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(PartitionFieldMath.add(a, b)).toBe((a + b) % PARTITION_PRIME);
      expect(PartitionFieldMath.sub(a, b)).toBe(((a - b) % PARTITION_PRIME + PARTITION_PRIME) % PARTITION_PRIME);
      expect(PartitionFieldMath.mul(a, b)).toBe((a * b) % PARTITION_PRIME);
    });

    it('decomposes and recomposes values in base B correctly', () => {
      const value = 305419896n; // 0x12345678
      const radix = 16n;
      const numDigits = 8;

      const digits = prover.decompose(value, radix, numDigits);
      expect(digits.length).toBe(numDigits);
      for (const d of digits) {
        expect(d >= 0n && d < radix).toBe(true);
      }

      const recomposed = prover.recompose(digits, radix);
      expect(recomposed).toBe(value);
    });

    it('throws error when value exceeds digit capacity', () => {
      expect(() => {
        prover.decompose(100n, 2n, 4); // max 2^4 - 1 = 15
      }).toThrow('exceeds capacity');
    });
  });

  describe('Zero-Knowledge Range Partition Proving & Verification', () => {
    it('proves and verifies honest range partition proof', () => {
      const value = 250n;
      const radix = 16n;
      const numDigits = 2; // 250 = 10 + 15*16

      const proof = prover.provePartition(value, radix, numDigits);

      expect(proof.numDigits).toBe(numDigits);
      expect(proof.componentCommitments.length).toBe(numDigits);
      expect(proof.responsesV.length).toBe(numDigits);

      const verification = prover.verifyPartition(proof);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered challenge', () => {
      const value = 42n;
      const proof = prover.provePartition(value, 8n, 2);

      const tampered = {
        ...proof,
        challenge: proof.challenge + 1n,
      };

      const res = prover.verifyPartition(tampered);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('challenge mismatch');
    });

    it('rejects tampered commitment homomorphism', () => {
      const value = 99n;
      const proof = prover.provePartition(value, 10n, 2);

      const tampered = {
        ...proof,
        commitmentV: proof.commitmentV + 1n,
      };

      const res = prover.verifyPartition(tampered);
      expect(res.valid).toBe(false);
    });
  });

  describe('Batch Partition Verification', () => {
    it('verifies a batch of independent partition proofs', () => {
      const p1 = prover.provePartition(123n, 10n, 3);
      const p2 = prover.provePartition(456n, 10n, 3);
      const p3 = prover.provePartition(789n, 10n, 3);

      const batchRes = prover.verifyBatch([p1, p2, p3]);
      expect(batchRes.valid).toBe(true);
      expect(batchRes.verifiedCount).toBe(3);
      expect(batchRes.errors.length).toBe(0);
    });
  });
});
