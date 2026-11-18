import {
  LogarithmicLookupProver,
  LogUpFieldMath,
  LOGUP_PRIME,
} from '../../core/zkp/LogarithmicLookupProver';

describe('LogarithmicLookupProver', () => {
  let prover: LogarithmicLookupProver;

  beforeEach(() => {
    prover = new LogarithmicLookupProver();
  });

  describe('Field Math & LogUp Multiplicities', () => {
    it('performs modular arithmetic mod LOGUP_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(LogUpFieldMath.add(a, b)).toBe((a + b) % LOGUP_PRIME);
      expect(LogUpFieldMath.sub(a, b)).toBe(((a - b) % LOGUP_PRIME + LOGUP_PRIME) % LOGUP_PRIME);
      expect(LogUpFieldMath.mul(a, b)).toBe((a * b) % LOGUP_PRIME);
    });

    it('computes correct multiplicities for table elements', () => {
      const table = [10n, 20n, 30n, 40n, 50n];
      const witness = [20n, 10n, 20n, 50n]; // 10n:1, 20n:2, 30n:0, 40n:0, 50n:1

      const mults = prover.computeMultiplicities(table, witness);
      expect(mults).toEqual([1n, 2n, 0n, 0n, 1n]);
    });

    it('throws error when witness contains non-table element', () => {
      const table = [10n, 20n, 30n];
      const witness = [10n, 999n];

      expect(() => {
        prover.computeMultiplicities(table, witness);
      }).toThrow('Lookup containment failure');
    });

    it('satisfies LogUp fractional sum equality', () => {
      const table = [5n, 15n, 25n, 35n];
      const witness = [15n, 5n, 15n, 35n];
      const mults = prover.computeMultiplicities(table, witness);
      const beta = 1337n;

      const sumWitness = prover.computeFractionalSumWitness(witness, beta);
      const sumTable = prover.computeFractionalSumTable(table, mults, beta);

      expect(sumWitness).toBe(sumTable);
    });
  });

  describe('Zero-Knowledge Lookup Proof Generation & Verification', () => {
    it('proves and verifies valid witness table containment', () => {
      const table = [100n, 200n, 300n, 400n];
      const witness = [200n, 400n, 200n];

      const basisF = prover.generateBasis(witness.length, 'BasisF');
      const basisM = prover.generateBasis(table.length, 'BasisM');

      const proof = prover.proveLookup(table, witness, basisF, basisM);
      expect(proof.witnessLength).toBe(3);
      expect(proof.tableLength).toBe(4);

      const verification = prover.verifyLookup(proof, table);
      expect(verification.valid).toBe(true);
    });

    it('rejects tampered challenge', () => {
      const table = [1n, 2n, 3n];
      const witness = [2n, 1n];

      const basisF = prover.generateBasis(witness.length, 'BasisF');
      const basisM = prover.generateBasis(table.length, 'BasisM');

      const proof = prover.proveLookup(table, witness, basisF, basisM);
      const tampered = { ...proof, challenge: proof.challenge + 1n };

      const res = prover.verifyLookup(tampered, table);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('challenge mismatch');
    });
  });

  describe('Batch LogUp Verification', () => {
    it('verifies a batch of independent LogUp proofs', () => {
      const t1 = [10n, 20n, 30n];
      const w1 = [10n, 30n];
      const bF1 = prover.generateBasis(2, 'BF1');
      const bM1 = prover.generateBasis(3, 'BM1');
      const p1 = prover.proveLookup(t1, w1, bF1, bM1);

      const t2 = [5n, 15n, 25n, 35n];
      const w2 = [25n, 5n, 15n];
      const bF2 = prover.generateBasis(3, 'BF2');
      const bM2 = prover.generateBasis(4, 'BM2');
      const p2 = prover.proveLookup(t2, w2, bF2, bM2);

      const batch = prover.verifyBatch([p1, p2], [t1, t2]);
      expect(batch.valid).toBe(true);
      expect(batch.verifiedCount).toBe(2);
      expect(batch.errors.length).toBe(0);
    });
  });
});
