import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePaillierAdditiveProver } from '../../core/zkp/ZeroKnowledgePaillierAdditiveProver';

describe('ZeroKnowledgePaillierAdditiveProver', () => {
  const paillier = new ZeroKnowledgePaillierAdditiveProver();

  it('encrypts, adds homomorphically, scales, rerandomizes, and proves plaintext knowledge', () => {
    const key = paillier.generateKeyPair('ws-paillier-1');
    const e1 = paillier.encryptWithWitness(key, 'c1', 350n);
    const e2 = paillier.encryptWithWitness(key, 'c2', 650n);

    expect(paillier.decrypt(key, e1.ciphertext.value)).toBe(350n);
    const rerand = paillier.rerandomize(key, e1.ciphertext.value);
    expect(rerand).not.toBe(e1.ciphertext.value);
    expect(paillier.decrypt(key, rerand)).toBe(350n);

    const sumCt = paillier.homomorphicAdd(key, 'sum', [e1.ciphertext.value, e2.ciphertext.value]);
    expect(paillier.decrypt(key, sumCt.value)).toBe(1000n);

    const scaled = paillier.homomorphicScale(key, '3x', e1.ciphertext.value, 3n);
    expect(paillier.decrypt(key, scaled.value)).toBe(1050n);

    const pok = paillier.provePlaintextKnowledge('pok-1', key, e1.ciphertext.value, 350n, e1.randomnessR);
    expect(paillier.verifyPlaintextKnowledge(key, pok)).toBe(true);
    expect(paillier.verifyPlaintextKnowledge(key, { ...pok, responseZ1: pok.responseZ1 + 1n })).toBe(false);

    const json = paillier.serializePoKProof(pok);
    const restored = paillier.deserializePoKProof(json);
    expect(restored).toEqual(pok);
    expect(paillier.verifyPlaintextKnowledge(key, restored)).toBe(true);
  });

  it('audits homomorphic ciphertext sums with verifiable aggregate randomness witnesses', () => {
    const key = paillier.generateKeyPair('ws-paillier-audit', 10n, 20n);
    const vals = [120n, 480n, 250n, 150n];
    const cts = vals.map((v, i) => paillier.encryptWithWitness(key, `v-${i}`, v).ciphertext.value);

    const audit = paillier.auditHomomorphicSum('budget-sum', key, cts);
    expect(audit.decryptedSum).toBe(1000n);
    expect(paillier.verifyHomomorphicSumAudit(key, audit)).toBe(true);
    expect(paillier.verifyHomomorphicSumAudit(key, { ...audit, decryptedSum: 1001n })).toBe(false);
  });
});
