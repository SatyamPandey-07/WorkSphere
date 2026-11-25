import { describe, it, expect } from 'vitest';
import { VerifiablePedersenInnerProductCheck } from '../../core/zkp/VerifiablePedersenInnerProductCheck';

describe('VerifiablePedersenInnerProductCheck', () => {
  const ip = new VerifiablePedersenInnerProductCheck();

  it('proves inner-product equality and orthogonality over hidden Pedersen-committed vectors', () => {
    const vecA = ip.commitVector('a', [3n, 5n, 2n, 7n]);
    const vecB = ip.commitVector('b', [4n, 1n, 6n, 2n]); // 12 + 5 + 12 + 14 = 43

    const proof = ip.proveInnerProduct('ip-check-1', vecA, vecB);
    expect(proof.claimedInnerProduct).toBe(43n);
    expect(ip.verifyInnerProduct(proof, vecA.commitments, vecB.commitments).valid).toBe(true);
    expect(ip.verifyInnerProduct({ ...proof, claimedInnerProduct: 44n }, vecA.commitments, vecB.commitments).valid).toBe(false);

    // Orthogonality check: <u, v> == 0 mod q
    const q = 0x7fffffffffffffffffffffffffffe1d3n;
    const u = ip.commitVector('u', [2n, 3n]);
    const v = ip.commitVector('v', [3n, q - 2n]);
    const orthoProof = ip.proveInnerProduct('ip-ortho', u, v);
    expect(ip.verifyOrthogonality(orthoProof, u.commitments, v.commitments)).toBe(true);

    const json = ip.serializeProof(proof);
    const restored = ip.deserializeProof(json);
    expect(restored).toEqual(proof);
    expect(ip.verifyInnerProduct(restored, vecA.commitments, vecB.commitments).valid).toBe(true);
  });
});
