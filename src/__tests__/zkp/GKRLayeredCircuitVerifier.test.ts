import { GKRLayeredCircuitVerifier, LayeredCircuit } from '../../core/zkp/GKRLayeredCircuitVerifier';

const SAMPLE_CIRCUIT: LayeredCircuit = {
  inputBits: 2, // 4 inputs: x0, x1, x2, x3
  layers: [
    // Output layer (layer 0, 2 gates)
    {
      numBits: 1,
      gates: [
        { op: 'mul', left: 0, right: 1 },
        { op: 'add', left: 2, right: 3 },
      ],
    },
    // Hidden layer (layer 1, 4 gates)
    {
      numBits: 2,
      gates: [
        { op: 'add', left: 0, right: 1 },
        { op: 'mul', left: 1, right: 2 },
        { op: 'mul', left: 2, right: 3 },
        { op: 'add', left: 0, right: 3 },
      ],
    },
  ],
};

describe('GKRLayeredCircuitVerifier', () => {
  it('proves and verifies multi-layer arithmetic circuit execution via GKR sumcheck reductions', () => {
    const gkr = new GKRLayeredCircuitVerifier(SAMPLE_CIRCUIT);
    const inputs = [3n, 5n, 7n, 11n];

    const proof = gkr.prove(inputs);
    // Layer 1: [8, 35, 77, 14] -> Layer 0: [8*35=280, 77+14=91]
    expect(proof.outputValues).toEqual([280n, 91n]);

    const res = gkr.verify(inputs, proof);
    expect(res.isValid).toBe(true);
    expect(res.verifiedLayers).toBe(2);
  });

  it('rejects tampered circuit outputs, wrong inputs, or corrupted sumcheck rounds', () => {
    const gkr = new GKRLayeredCircuitVerifier(SAMPLE_CIRCUIT);
    const inputs = [2n, 4n, 6n, 8n];
    const proof = gkr.prove(inputs);

    expect(gkr.verify([2n, 4n, 6n, 9n], proof).isValid).toBe(false);
    expect(
      gkr.verify(inputs, { ...proof, outputValues: [proof.outputValues[0] + 1n, proof.outputValues[1]] })
        .isValid
    ).toBe(false);

    const badLayer = [...proof.layerProofs];
    badLayer[0] = { ...badLayer[0], evalU: badLayer[0].evalU + 1n };
    expect(gkr.verify(inputs, { ...proof, layerProofs: badLayer }).isValid).toBe(false);
  });
});
