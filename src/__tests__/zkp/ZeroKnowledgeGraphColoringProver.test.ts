import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeGraphColoringProver } from '../../core/zkp/ZeroKnowledgeGraphColoringProver';

describe('ZeroKnowledgeGraphColoringProver', () => {
  const prover = new ZeroKnowledgeGraphColoringProver();

  it('finds a valid 3-coloring and verifies a non-interactive Fiat-Shamir GMW proof', () => {
    const graph = {
      graphId: 'room-conflict-floor-3',
      vertexCount: 6,
      edges: [
        [0, 1],
        [1, 2],
        [2, 0],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 3],
        [0, 4],
      ] as Array<[number, number]>,
    };

    const coloring = prover.findValid3Coloring(graph);
    expect(coloring).not.toBeNull();
    expect(prover.validateColoringWitness(graph, coloring!).valid).toBe(true);

    const proof = prover.prove3Coloring(graph, coloring!, 20);
    expect(proof.rounds).toHaveLength(20);
    expect(proof.soundnessErrorUpperBound).toBeLessThan(0.1);
    expect(prover.verify3ColoringProof(graph, proof).valid).toBe(true);
  });

  it('detects uncolorable K4 conflict graphs and rejects tampered proof rounds', () => {
    const k4 = {
      graphId: 'uncolorable-k4',
      vertexCount: 4,
      edges: [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
        [2, 3],
      ] as Array<[number, number]>,
    };
    expect(prover.findValid3Coloring(k4)).toBeNull();
    expect(() => prover.prove3Coloring(k4, [0, 1, 2, 0], 10)).toThrow();

    const tri = {
      graphId: 'tri',
      vertexCount: 3,
      edges: [
        [0, 1],
        [1, 2],
        [2, 0],
      ] as Array<[number, number]>,
    };
    const proof = prover.prove3Coloring(tri, [0, 1, 2], 12);
    const badRound = { ...proof.rounds[3], colorV: proof.rounds[3].colorU };
    const tampered = {
      ...proof,
      rounds: [...proof.rounds.slice(0, 3), badRound, ...proof.rounds.slice(4)],
    };
    const res = prover.verify3ColoringProof(tri, tampered);
    expect(res.valid).toBe(false);
    expect(res.failedRound).toBe(3);
  });

  it('round-trips JSON serialization for GMW 3-coloring proofs', () => {
    const cycle = {
      graphId: 'cycle-5',
      vertexCount: 5,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 0],
      ] as Array<[number, number]>,
    };
    const coloring = prover.findValid3Coloring(cycle)!;
    const proof = prover.prove3Coloring(cycle, coloring, 10);

    const json = prover.serializeProof(proof);
    const restored = prover.deserializeProof(json);
    expect(restored).toEqual(proof);
    expect(prover.verify3ColoringProof(cycle, restored).valid).toBe(true);
  });
});
