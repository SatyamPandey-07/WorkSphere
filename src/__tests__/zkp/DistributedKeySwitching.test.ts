import { DistributedKeySwitching } from '../../core/zkp/DistributedKeySwitching';

describe('DistributedKeySwitching', () => {
  it('switches an ElGamal ciphertext from delegator to delegatee via (t, n) verified proxy transforms', () => {
    const dks = new DistributedKeySwitching(3, 5);
    const alice = dks.generateKeyPair('alice-delegator-01');
    const bob = dks.generateKeyPair('bob-delegatee-02');

    const delegation = dks.createDelegation(alice, bob, 'deleg-epoch-01');
    for (const share of delegation.proxyShares) {
      expect(dks.verifyProxyShareAgainstFeldman(share, delegation.feldmanCommitments)).toBe(true);
    }

    const plainPoint = dks.encodePlaintextPoint(987654321n);
    const ctForAlice = dks.encrypt(alice.publicPoint, plainPoint, 'msg-nonce-01');
    expect(dks.decrypt(alice.witnessScalar, ctForAlice)).toBe(plainPoint);

    const pubMap = new Map(delegation.proxyShares.map((s) => [s.proxyId, s.publicVerificationPoint]));
    const capsules = [delegation.proxyShares[0], delegation.proxyShares[2], delegation.proxyShares[4]].map(
      (s) => dks.computePartialTransform(s, ctForAlice, 'tx-01')
    );

    const switched = dks.combineTransforms(ctForAlice, capsules, pubMap);
    expect(switched.isValid).toBe(true);
    expect(switched.switchedCiphertext).not.toBeNull();
    expect(dks.decrypt(bob.witnessScalar, switched.switchedCiphertext!)).toBe(plainPoint);
  });

  it('rejects corrupted proxy transforms and invalid DLEQ proofs', () => {
    const dks = new DistributedKeySwitching(2, 3);
    const alice = dks.generateKeyPair('alice-02');
    const bob = dks.generateKeyPair('bob-02');
    const delegation = dks.createDelegation(alice, bob, 'deleg-02');
    const pubMap = new Map(delegation.proxyShares.map((s) => [s.proxyId, s.publicVerificationPoint]));

    const ct = dks.encrypt(alice.publicPoint, dks.encodePlaintextPoint(55n), 'n2');
    const c1 = dks.computePartialTransform(delegation.proxyShares[0], ct, 't1');
    const c2 = dks.computePartialTransform(delegation.proxyShares[1], ct, 't2');

    const tampered = [{ ...c1, transformedC1: c1.transformedC1 + 1n }, c2];
    expect(dks.combineTransforms(ct, tampered, pubMap).isValid).toBe(false);
    expect(dks.combineTransforms(ct, [c1], pubMap).isValid).toBe(false);
  });
});
