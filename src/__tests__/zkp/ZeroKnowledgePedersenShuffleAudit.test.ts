import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePedersenShuffleAudit, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgePedersenShuffleAudit';

describe('ZeroKnowledgePedersenShuffleAudit', () => {
  const auditor = new ZeroKnowledgePedersenShuffleAudit();

  it('proves Pedersen commitment shuffle invariance via grand-product argument and rejects altered outputs', () => {
    const inputs = auditor.commitBatch([10n, 25n, 40n, 75n, 90n]);
    const { outputItems, proof } = auditor.shuffleAndProve(inputs, 'deck-round-1');

    expect(auditor.verifyShuffle(proof)).toBe(true);
    expect(outputItems.map((x) => x.value).sort((a, b) => Number(a - b))).toEqual([10n, 25n, 40n, 75n, 90n]);

    // Chain a second shuffle stage off outputItems
    const stage2 = auditor.shuffleAndProve(outputItems, 'deck-round-2');
    expect(auditor.verifyShuffle(stage2.proof)).toBe(true);

    // Tampered output commitment breaks verification
    const badOutputs = [...proof.outputs];
    badOutputs[2] = (badOutputs[2] * 4n) % SAFE_PRIME_P;
    expect(auditor.verifyShuffle({ ...proof, outputs: badOutputs })).toBe(false);

    // Tampered multiplication gate proof breaks verification
    const badGates = proof.inputMultProofs.map((g, i) => (i === 1 ? { ...g, respB: (g.respB + 1n) % SUBGROUP_Q } : g));
    expect(auditor.verifyShuffle({ ...proof, inputMultProofs: badGates })).toBe(false);
    expect(auditor.verifyShuffle({ ...proof, equalityResponseR: (proof.equalityResponseR + 1n) % SUBGROUP_Q })).toBe(false);
    expect(auditor.verifyShuffle({ ...proof, sumResponseR: (proof.sumResponseR + 1n) % SUBGROUP_Q })).toBe(false);

    // Single-element shuffle edge case
    const single = auditor.commitBatch([42n]);
    const singleShuffle = auditor.shuffleAndProve(single, 'single');
    expect(auditor.verifyShuffle(singleShuffle.proof)).toBe(true);

    const json = JSON.parse(auditor.serializeProof(proof)) as { batchSize: number; context: string };
    expect(json.batchSize).toBe(5);
    expect(json.context).toBe('deck-round-1');
  });
});
