/**
 * @file ZKMembershipVerifier.test.ts
 * @description Comprehensive test suite for Zero-Knowledge Membership Verifier,
 * BN254 elliptic curve group arithmetic, Sparse Merkle Tree path verification,
 * and nullifier tracking.
 */

import {
  BN254_FIELD_MODULUS,
  BN254_SCALAR_ORDER,
  FieldArithmetic,
  G1Group,
  G1Point,
  G2Point,
  NullifierRegistry,
  SparseMerkleVerifier,
  VerificationKey,
  ZKMembershipVerifier,
  ZKProof,
} from '../../core/zkp/ZKMembershipVerifier';

describe('ZKMembershipVerifier & BN254 Cryptographic Engine', () => {
  // BN254 G1 Generator point: x = 1, y = 2 satisfies y^2 = x^3 + 3
  const G1_GEN: G1Point = { x: 1n, y: 2n };
  const G2_DUMMY: G2Point = {
    x: [1n, 2n],
    y: [3n, 4n],
  };

  describe('FieldArithmetic', () => {
    it('performs modular addition and subtraction correctly', () => {
      const a = BN254_FIELD_MODULUS - 10n;
      const b = 15n;
      const sum = FieldArithmetic.add(a, b);
      expect(sum).toBe(5n);

      const diff = FieldArithmetic.sub(5n, 15n);
      expect(diff).toBe(BN254_FIELD_MODULUS - 10n);
    });

    it('performs modular multiplication, exponentiation, and inversion', () => {
      const a = 123456789n;
      const aInv = FieldArithmetic.inv(a);
      const prod = FieldArithmetic.mul(a, aInv);
      expect(prod).toBe(1n);

      const exp = FieldArithmetic.exp(2n, 10n);
      expect(exp).toBe(1024n);
    });

    it('throws when computing modular inverse of zero', () => {
      expect(() => FieldArithmetic.inv(0n)).toThrow('Division by zero in finite field');
    });
  });

  describe('G1Group BN254 Elliptic Curve', () => {
    it('accurately identifies points on and off the curve', () => {
      expect(G1Group.isPointOnCurve(G1_GEN)).toBe(true);
      expect(G1Group.isPointOnCurve(G1Group.INFINITY)).toBe(true);

      const invalidPoint: G1Point = { x: 1n, y: 3n }; // 3^2 = 9 != 4
      expect(G1Group.isPointOnCurve(invalidPoint)).toBe(false);
    });

    it('performs point addition and point doubling', () => {
      // 2 * G1_GEN
      const doubleG = G1Group.add(G1_GEN, G1_GEN);
      expect(G1Group.isPointOnCurve(doubleG)).toBe(true);
      expect(doubleG.x).not.toBe(G1_GEN.x);

      // G + INFINITY = G
      const sumInf = G1Group.add(G1_GEN, G1Group.INFINITY);
      expect(sumInf.x).toBe(G1_GEN.x);
      expect(sumInf.y).toBe(G1_GEN.y);
    });

    it('computes scalar multiplication matching repeated addition', () => {
      const p2 = G1Group.add(G1_GEN, G1_GEN);
      const p3 = G1Group.add(p2, G1_GEN);

      const mul3 = G1Group.mulScalar(G1_GEN, 3n);
      expect(mul3.x).toBe(p3.x);
      expect(mul3.y).toBe(p3.y);

      const mul0 = G1Group.mulScalar(G1_GEN, 0n);
      expect(mul0.isInfinity).toBe(true);
    });

    it('computes multi-scalar multiplication (MSM)', () => {
      const points = [G1_GEN, G1_GEN, G1_GEN]; // IC_0, IC_1, IC_2
      const scalars = [2n, 3n]; // IC_0 + 2*IC_1 + 3*IC_2 = 6 * G1_GEN

      const msmResult = G1Group.msm(points, scalars);
      const expected = G1Group.mulScalar(G1_GEN, 6n);

      expect(msmResult.x).toBe(expected.x);
      expect(msmResult.y).toBe(expected.y);
    });
  });

  describe('NullifierRegistry', () => {
    it('registers unique nullifiers and detects replays', () => {
      const registry = new NullifierRegistry();
      const nullifier = '0xabcdef1234567890';

      expect(registry.has(nullifier)).toBe(false);
      expect(registry.register(nullifier)).toBe(true);
      expect(registry.has(nullifier)).toBe(true);

      // Attempt second registration (replay attack)
      expect(registry.register(nullifier)).toBe(false);
      expect(registry.size()).toBe(1);

      // Case insensitive check
      expect(registry.has(nullifier.toUpperCase())).toBe(true);
    });
  });

  describe('SparseMerkleVerifier', () => {
    it('verifies a valid Merkle inclusion proof', () => {
      const leaf = SparseMerkleVerifier.computeLeaf('0x1111222233334444');
      const sibling1 = SparseMerkleVerifier.computeLeaf('0x9999888877776666');

      // level 1: hash(leaf, sibling1) -> left child (index 0)
      const parent1 = SparseMerkleVerifier.hashPair(leaf, sibling1);

      const sibling2 = SparseMerkleVerifier.computeLeaf('0xaaaabbbbccccdddd');
      // level 2: hash(parent1, sibling2) -> left child (index 0)
      const root = SparseMerkleVerifier.hashPair(parent1, sibling2);

      const isValid = SparseMerkleVerifier.verifyPath(
        leaf,
        [sibling1, sibling2],
        [0, 0],
        root
      );
      expect(isValid).toBe(true);
    });

    it('rejects tampered Merkle paths', () => {
      const leaf = SparseMerkleVerifier.computeLeaf('0x1111222233334444');
      const sibling1 = SparseMerkleVerifier.computeLeaf('0x9999888877776666');
      const parent1 = SparseMerkleVerifier.hashPair(leaf, sibling1);
      const sibling2 = SparseMerkleVerifier.computeLeaf('0xaaaabbbbccccdddd');
      const root = SparseMerkleVerifier.hashPair(parent1, sibling2);

      const isInvalid = SparseMerkleVerifier.verifyPath(
        leaf,
        [sibling1, '0x0000000000000000'],
        [0, 0],
        root
      );
      expect(isInvalid).toBe(false);
    });
  });

  describe('ZKMembershipVerifier Core Logic', () => {
    const mockVK: VerificationKey = {
      alpha: G1_GEN,
      beta: G2_DUMMY,
      gamma: G2_DUMMY,
      delta: G2_DUMMY,
      ic: [
        G1_GEN, // IC_0
        G1Group.mulScalar(G1_GEN, 2n), // IC_1 (root)
        G1Group.mulScalar(G1_GEN, 3n), // IC_2 (nullifier)
        G1Group.mulScalar(G1_GEN, 4n), // IC_3 (epoch)
        G1Group.mulScalar(G1_GEN, 5n), // IC_4 (scope)
      ],
    };

    const mockProof: ZKProof = {
      a: G1_GEN,
      b: G2_DUMMY,
      c: G1_GEN,
    };

    it('verifies a valid claim within allowed root and fresh epoch', () => {
      const verifier = new ZKMembershipVerifier();
      const currentEpoch = Math.floor(Date.now() / 1000);
      const root = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      verifier.addAllowedRoot(root);

      const claim = {
        proof: mockProof,
        publicInputs: {
          root,
          nullifierHash: '0xaabbccddeeff00112233445566778899',
          epoch: currentEpoch,
          scope: 'workspace-governance-proposal-42',
        },
      };

      const result = verifier.verifyMembership(claim, mockVK);
      expect(result.valid).toBe(true);
      expect(result.nullifierHash).toBe(claim.publicInputs.nullifierHash);
    });

    it('rejects claim with unapproved Merkle root', () => {
      const verifier = new ZKMembershipVerifier();
      verifier.addAllowedRoot('0xallowedroot0000000000000000000000000000000000000000000000000000');

      const claim = {
        proof: mockProof,
        publicInputs: {
          root: '0xunauthorizedroot000000000000000000000000000000000000000000000000',
          nullifierHash: '0x112233445566',
          epoch: Math.floor(Date.now() / 1000),
          scope: 'governance',
        },
      };

      const result = verifier.verifyMembership(claim, mockVK);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('is not recognized or allowed');
    });

    it('rejects claim with expired epoch', () => {
      const verifier = new ZKMembershipVerifier({ maxEpochAge: 3600 });
      const staleEpoch = Math.floor(Date.now() / 1000) - 7200; // 2 hours old

      const claim = {
        proof: mockProof,
        publicInputs: {
          root: '0xroot',
          nullifierHash: '0x112233445566',
          epoch: staleEpoch,
          scope: 'governance',
        },
      };

      const result = verifier.verifyMembership(claim, mockVK);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('atomically consumes claim and prevents double-spending', () => {
      const verifier = new ZKMembershipVerifier();
      const currentEpoch = Math.floor(Date.now() / 1000);
      const claim = {
        proof: mockProof,
        publicInputs: {
          root: '0xvalidroot',
          nullifierHash: '0xsingleuse9988776655',
          epoch: currentEpoch,
          scope: 'treasury-vote',
        },
      };

      const firstSpend = verifier.verifyAndConsumeClaim(claim, mockVK);
      expect(firstSpend.valid).toBe(true);

      const secondSpend = verifier.verifyAndConsumeClaim(claim, mockVK);
      expect(secondSpend.valid).toBe(false);
      expect(secondSpend.reason).toContain('already been registered or spent');
    });

    it('rejects proof with invalid curve point', () => {
      const verifier = new ZKMembershipVerifier();
      const corruptProof: ZKProof = {
        a: { x: 1n, y: 3n }, // Invalid BN254 point
        b: G2_DUMMY,
        c: G1_GEN,
      };

      const claim = {
        proof: corruptProof,
        publicInputs: {
          root: '0xvalidroot',
          nullifierHash: '0xhash',
          epoch: Math.floor(Date.now() / 1000),
          scope: 'test',
        },
      };

      const result = verifier.verifyMembership(claim, mockVK);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Groth16 pairing constraint or curve check failed');
    });
  });
});
