import { describe, it, expect } from 'vitest';
import { VerifiableElGamalThresholdMixnet } from '../../core/zkp/VerifiableElGamalThresholdMixnet';

describe('VerifiableElGamalThresholdMixnet', () => {
  const mixnet = new VerifiableElGamalThresholdMixnet();

  it('verifies multi-stage re-encryption mixing and threshold decrypts ballots while isolating faulty guardians', () => {
    const setup = mixnet.setupCommittee(3, [1, 2, 3, 4, 5]);
    const plaintexts = [11n, 27n, 42n, 88n];
    const inputs = plaintexts.map((m) => mixnet.encryptMessage(setup.groupPublicKey, m));

    const stage1 = mixnet.mixAndProve('mix-node-1', setup.groupPublicKey, inputs);
    expect(mixnet.verifyMixStage(stage1)).toBe(true);

    const stage2 = mixnet.mixAndProve('mix-node-2', setup.groupPublicKey, stage1.outputs);
    expect(mixnet.verifyMixStage(stage2)).toBe(true);

    // Tampering with an output ciphertext breaks homomorphic invariance proof
    const tamperedOutputs = stage2.outputs.map((c, idx) => (idx === 0 ? { ...c, c2: (c.c2 * 4n) % 0xffffffffffffffffffffffffffffc3a7n } : c));
    expect(mixnet.verifyMixStage({ ...stage2, outputs: tamperedOutputs })).toBe(false);

    // Threshold decrypt every mixed ciphertext with 1 corrupted guardian share
    const decrypted: bigint[] = [];
    for (const ct of stage2.outputs) {
      const s1 = mixnet.produceDecryptionShare(setup.guardians[0], ct);
      const s2Bad = { ...mixnet.produceDecryptionShare(setup.guardians[1], ct), response: 777n };
      const s3 = mixnet.produceDecryptionShare(setup.guardians[2], ct);
      const s5 = mixnet.produceDecryptionShare(setup.guardians[4], ct);
      const res = mixnet.thresholdDecrypt(setup, ct, [s1, s2Bad, s3, s5], 200n);
      expect(res.faultyGuardians).toEqual([2]);
      expect(res.plaintextCode).not.toBeNull();
      decrypted.push(res.plaintextCode!);
    }

    expect([...decrypted].sort((a, b) => Number(a - b))).toEqual(plaintexts);

    const json = JSON.parse(mixnet.serializeStage(stage2)) as { stageId: string; batchSize: number };
    expect(json.stageId).toBe('mix-node-2');
    expect(json.batchSize).toBe(4);
  });
});
