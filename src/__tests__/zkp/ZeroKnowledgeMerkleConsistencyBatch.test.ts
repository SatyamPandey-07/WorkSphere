import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleConsistencyBatch } from '../../core/zkp/ZeroKnowledgeMerkleConsistencyBatch';

describe('ZeroKnowledgeMerkleConsistencyBatch', () => {
  it('verifies RFC 6962 append-only consistency proofs across arbitrary sizes and inclusion audits', () => {
    const log = new ZeroKnowledgeMerkleConsistencyBatch();
    log.appendBatch(['ev-0', 'ev-1', 'ev-2']);
    log.appendBatch(['ev-3', 'ev-4', 'ev-5', 'ev-6', 'ev-7']);
    log.appendBatch(['ev-8', 'ev-9', 'ev-10', 'ev-11', 'ev-12']);

    const c3to8 = log.generateConsistencyProof(3, 8);
    const c8to13 = log.generateConsistencyProof(8, 13);
    const c3to13 = log.generateConsistencyProof(3, 13);
    const c1to13 = log.generateConsistencyProof(1, 13);
    const c8to8 = log.generateConsistencyProof(8, 8);

    expect(log.verifyConsistencyProof(c3to8)).toBe(true);
    expect(log.verifyConsistencyProof(c8to13)).toBe(true);
    expect(log.verifyConsistencyProof(c3to13)).toBe(true);
    expect(log.verifyConsistencyProof(c1to13)).toBe(true);
    expect(log.verifyConsistencyProof(c8to8)).toBe(true);

    expect(log.verifyConsistencyChain([c3to8, c8to13])).toEqual({ allValid: true, brokenAt: -1 });
    expect(log.verifyConsistencyProof({ ...c3to13, firstRoot: '00'.repeat(32) })).toBe(false);

    for (const idx of [0, 3, 7, 12]) {
      const inc = log.generateInclusionProof(idx, 13);
      expect(log.verifyInclusionProof(inc)).toBe(true);
      expect(log.verifyInclusionProof({ ...inc, leafData: 'forged' })).toBe(false);
    }

    const json = JSON.parse(log.serializeProof(c3to13)) as { firstSize: number; secondSize: number };
    expect(json.firstSize).toBe(3);
    expect(json.secondSize).toBe(13);
  });

  it('exhaustively verifies every (m, n) consistency pair for 1 <= m <= n <= 16', () => {
    const log = new ZeroKnowledgeMerkleConsistencyBatch();
    for (let i = 0; i < 16; i++) {
      const cp = log.append(`cert-entry-${i}`);
      expect(cp.treeSize).toBe(i + 1);
    }
    expect(log.getSize()).toBe(16);

    for (let m = 1; m <= 16; m++) {
      for (let n = m; n <= 16; n++) {
        const proof = log.generateConsistencyProof(m, n);
        expect(log.verifyConsistencyProof(proof)).toBe(true);
      }
    }
  });

  it('verifies every leaf inclusion proof across power-of-2 and odd tree sizes', () => {
    const log = new ZeroKnowledgeMerkleConsistencyBatch();
    log.appendBatch(Array.from({ length: 11 }, (_, i) => `tx-${i}`));

    for (const size of [1, 2, 3, 4, 7, 8, 11]) {
      for (let idx = 0; idx < size; idx++) {
        const inc = log.generateInclusionProof(idx, size);
        expect(log.verifyInclusionProof(inc)).toBe(true);
      }
    }
  });

  it('detects split-view equivocation logs where historical leaves were altered', () => {
    const honest = new ZeroKnowledgeMerkleConsistencyBatch();
    const evil = new ZeroKnowledgeMerkleConsistencyBatch();

    honest.appendBatch(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    evil.appendBatch(['a', 'b', 'TAMPERED', 'd', 'e', 'f', 'g', 'h', 'i']);

    const cpHonest5 = honest.getCheckpoint(5);
    const evilProof = evil.generateConsistencyProof(5, 9);
    // Attempting to claim honest size-5 root is prefix of tampered size-9 log MUST fail!
    expect(evil.verifyConsistencyProof({ ...evilProof, firstRoot: cpHonest5.rootHash })).toBe(false);
  });

  it('rejects out-of-bounds arguments, broken chains, and tampered audit paths', () => {
    const log = new ZeroKnowledgeMerkleConsistencyBatch();
    expect(log.getRootAtSize(0)).toHaveLength(64);
    log.appendBatch(['x0', 'x1', 'x2', 'x3', 'x4', 'x5']);

    expect(() => log.getRootAtSize(-1)).toThrow();
    expect(() => log.getRootAtSize(7)).toThrow();
    expect(() => log.generateConsistencyProof(0, 6)).toThrow();
    expect(() => log.generateConsistencyProof(5, 4)).toThrow();
    expect(() => log.generateConsistencyProof(2, 7)).toThrow();
    expect(() => log.generateInclusionProof(-1, 6)).toThrow();
    expect(() => log.generateInclusionProof(6, 6)).toThrow();

    const p1 = log.generateConsistencyProof(2, 4);
    const p2 = log.generateConsistencyProof(4, 6);
    const pGap = log.generateConsistencyProof(5, 6);

    expect(log.verifyConsistencyChain([p1, p2])).toEqual({ allValid: true, brokenAt: -1 });
    expect(log.verifyConsistencyChain([p1, pGap])).toEqual({ allValid: false, brokenAt: 1 });
    expect(log.verifyConsistencyChain([{ ...p1, secondRoot: 'ff'.repeat(32) }, p2])).toEqual({ allValid: false, brokenAt: 0 });

    expect(log.verifyConsistencyProof({ ...p1, firstSize: 0 })).toBe(false);
    expect(log.verifyConsistencyProof({ ...p1, firstSize: 5, secondSize: 4 })).toBe(false);
    expect(log.verifyConsistencyProof({ ...p1, auditPath: [] })).toBe(false);
    expect(log.verifyConsistencyProof({ ...p1, auditPath: [...p1.auditPath, 'aa'.repeat(32)] })).toBe(false);

    const inc = log.generateInclusionProof(3, 6);
    expect(log.verifyInclusionProof({ ...inc, leafIndex: -1 })).toBe(false);
    expect(log.verifyInclusionProof({ ...inc, leafIndex: 6 })).toBe(false);
    expect(log.verifyInclusionProof({ ...inc, path: inc.path.slice(1) })).toBe(false);
    expect(log.verifyInclusionProof({ ...inc, rootHash: '00'.repeat(32) })).toBe(false);
  });

  it('scales to 64-entry logs with logarithmic O(log N) consistency and inclusion path sizes', () => {
    const bigLog = new ZeroKnowledgeMerkleConsistencyBatch();
    bigLog.appendBatch(Array.from({ length: 64 }, (_, i) => `block-header-${i}`));
    const proof17to64 = bigLog.generateConsistencyProof(17, 64);
    expect(proof17to64.auditPath.length).toBeLessThanOrEqual(8);
    expect(bigLog.verifyConsistencyProof(proof17to64)).toBe(true);
    const inc45 = bigLog.generateInclusionProof(45, 64);
    expect(inc45.path.length).toBe(6);
    expect(bigLog.verifyInclusionProof(inc45)).toBe(true);
  });
});
