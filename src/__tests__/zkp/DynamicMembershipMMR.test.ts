import {
  DynamicMembershipMMR,
  MMRFieldMath,
  MMR_PRIME,
} from '../../core/zkp/DynamicMembershipMMR';

describe('DynamicMembershipMMR', () => {
  let mmr: DynamicMembershipMMR;

  beforeEach(() => {
    mmr = new DynamicMembershipMMR();
  });

  describe('Field Math & MMR Construction', () => {
    it('performs modular arithmetic mod MMR_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(MMRFieldMath.add(a, b)).toBe((a + b) % MMR_PRIME);
      expect(MMRFieldMath.sub(a, b)).toBe(((a - b) % MMR_PRIME + MMR_PRIME) % MMR_PRIME);
      expect(MMRFieldMath.mul(a, b)).toBe((a * b) % MMR_PRIME);
    });

    it('dynamically appends leaves and bags peaks into a deterministic root', () => {
      const root0 = mmr.getRoot();
      expect(root0).toBeDefined();

      const r1 = mmr.append(100n);
      expect(r1.leafIndex).toBe(0);
      expect(mmr.getLeafCount()).toBe(1);

      const r2 = mmr.append(200n);
      expect(r2.leafIndex).toBe(1);

      const r3 = mmr.append(300n);
      expect(r3.leafIndex).toBe(2);

      // 3 leaves = 2 + 1 (2 peaks)
      const peaks = mmr.getPeaks();
      expect(peaks.length).toBe(2);
      expect(peaks[0].size).toBe(2);
      expect(peaks[1].size).toBe(1);
    });
  });

  describe('Inclusion Proofs & Zero-Knowledge Verification', () => {
    it('generates and verifies inclusion proofs for all leaves across multiple peaks', () => {
      // Append 7 leaves = 4 + 2 + 1
      for (let i = 1; i <= 7; i++) {
        mmr.append(BigInt(i * 10));
      }

      const root = mmr.getRoot();
      expect(mmr.getPeaks().length).toBe(3);

      for (let i = 0; i < 7; i++) {
        const proof = mmr.getProof(i);
        const isValid = DynamicMembershipMMR.verifyProof(proof, root);
        expect(isValid).toBe(true);
      }
    });

    it('rejects tampered inclusion proof leaf hash', () => {
      mmr.append(10n);
      mmr.append(20n);
      const root = mmr.getRoot();

      const proof = mmr.getProof(0);
      const tampered = { ...proof, leafHash: '0000000000000000000000000000000000000000000000000000000000000000' };

      expect(DynamicMembershipMMR.verifyProof(tampered, root)).toBe(false);
    });

    it('proves and verifies zero-knowledge membership proofs', () => {
      mmr.append(42n);
      mmr.append(84n);
      mmr.append(126n);

      const zkpProof = mmr.proveMembershipZKP(42n, 0);
      const res = mmr.verifyMembershipZKP(zkpProof);
      expect(res.valid).toBe(true);
    });

    it('rejects tampered ZKP challenge', () => {
      mmr.append(77n);
      const zkpProof = mmr.proveMembershipZKP(77n, 0);
      const tampered = { ...zkpProof, challenge: zkpProof.challenge + 1n };

      const res = mmr.verifyMembershipZKP(tampered);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('challenge mismatch');
    });
  });
});
