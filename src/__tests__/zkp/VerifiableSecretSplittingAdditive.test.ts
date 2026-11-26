import { describe, it, expect } from 'vitest';
import { VerifiableSecretSplittingAdditive } from '../../core/zkp/VerifiableSecretSplittingAdditive';

describe('VerifiableSecretSplittingAdditive', () => {
  const mpc = new VerifiableSecretSplittingAdditive();

  it('splits secrets into verifiable additive shares and isolates corrupted shareholders', () => {
    const parties = ['node-A', 'node-B', 'node-C', 'node-D'];
    const split = mpc.splitSecret('sec-x', 123456n, parties);

    const rec = mpc.reconstructVerified(split);
    expect(rec.valid).toBe(true);
    expect(rec.reconstructedValue).toBe(123456n);

    const corrupted = {
      ...split,
      shares: [
        split.shares[0],
        { ...split.shares[1], valueShare: split.shares[1].valueShare + 9n },
        split.shares[2],
        split.shares[3],
      ],
    };
    const badRec = mpc.reconstructVerified(corrupted);
    expect(badRec.valid).toBe(false);
    expect(badRec.faultyPartyIds).toEqual(['node-B']);
  });

  it('performs homomorphic addition, scalar scaling, and Beaver-triple MPC multiplication', () => {
    const parties = ['p1', 'p2', 'p3'];
    const x = mpc.splitSecret('x', 42n, parties);
    const y = mpc.splitSecret('y', 17n, parties);

    const sum = mpc.addShared('x+y', x, y);
    expect(mpc.reconstructVerified(sum).reconstructedValue).toBe(59n);

    const scaled = mpc.scaleShared('5x', x, 5n);
    expect(mpc.reconstructVerified(scaled).reconstructedValue).toBe(210n);

    const triple = mpc.generateBeaverTriple('beaver-1', parties);
    const mul = mpc.secureMultiplyWithBeaverTriple('x*y', x, y, triple);
    const mulRec = mpc.reconstructVerified(mul.productSecret);
    expect(mulRec.valid).toBe(true);
    expect(mulRec.reconstructedValue).toBe(42n * 17n);

    const pubJson = JSON.parse(mpc.serializePublicCommitments(mul.productSecret)) as {
      secretId: string;
      partyIds: string[];
    };
    expect(pubJson.secretId).toBe('x*y:product');
    expect(pubJson.partyIds).toEqual(parties);
  });
});
