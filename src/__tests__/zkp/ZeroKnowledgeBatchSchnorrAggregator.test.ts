import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeBatchSchnorrAggregator } from '../../core/zkp/ZeroKnowledgeBatchSchnorrAggregator';

describe('ZeroKnowledgeBatchSchnorrAggregator', () => {
  const cosi = new ZeroKnowledgeBatchSchnorrAggregator();

  it('executes a CoSi collective binary-tree signing ceremony and verifies in O(1)', () => {
    const cosigners = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'].map((id) => cosi.generateCosigner(id));
    const setup = cosi.setupCollectiveTree('cosi-cluster-2026', cosigners);

    const sig1 = cosi.signCollectiveTree(setup, 'sess-1', 'checkpoint-block-900', cosigners);
    const sig2 = cosi.signCollectiveTree(setup, 'sess-2', 'checkpoint-block-901', cosigners);

    expect(cosi.verifyCollectiveSignature(sig1)).toBe(true);
    expect(cosi.verifyCollectiveSignature({ ...sig1, message: 'forged-block' })).toBe(false);
    expect(cosi.batchVerifyCollective([sig1, sig2])).toBe(true);
    expect(cosi.locateFaultySubtrees(sig1)).toEqual([]);

    // Inject a corrupted leaf partial signature and verify fault localization
    const corrupted = {
      ...sig1,
      treeLevels: [
        [
          sig1.treeLevels[0][0],
          { ...sig1.treeLevels[0][1], subtreePartialS: sig1.treeLevels[0][1].subtreePartialS + 7n },
          ...sig1.treeLevels[0].slice(2),
        ],
        ...sig1.treeLevels.slice(1),
      ],
    };
    expect(cosi.locateFaultySubtrees(corrupted)).toEqual([sig1.treeLevels[0][1].memberIds[0]]);

    const compact = JSON.parse(cosi.serializeCompactSignature(sig1)) as { signerCount: number };
    expect(compact.signerCount).toBe(7);
  });
});
