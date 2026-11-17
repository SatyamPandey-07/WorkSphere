import { ZkNullifierVerifier } from '../../../src/lib/crypto/zkNullifierVerifier';
import { groth16 } from 'snarkjs';

jest.mock('snarkjs', () => ({
  groth16: {
    verify: jest.fn().mockResolvedValue(true)
  }
}));

describe('ZkNullifierVerifier - Batch Partitioning & Field Modulus', () => {
  let verifier: ZkNullifierVerifier;

  beforeEach(() => {
    verifier = new ZkNullifierVerifier();
    jest.clearAllMocks();
  });

  test('should successfully partition and verify batches from 1 to 64 nullifiers', async () => {
    for (let count = 1; count <= 64; count++) {
      const mockNullifiers = Array.from({ length: count }, (_, i) => (BigInt(1000 + i)).toString());
      const mockProof = { pi_a: [], pi_b: [], pi_c: [] };
      const mockSignals = ['1'];

      const result = await verifier.verifyBatch(mockNullifiers, mockProof, mockSignals);
      
      expect(result.verified).toBe(true);
      expect(result.processedNullifiers).toBe(count);
      expect(result.batchCount).toBe(Math.ceil(count / 32));
    }
  });

  test('should throw error when nullifier exceeds BN254 scalar field modulus', async () => {
    const invalidNullifier = '2188824287183927522246405745257275088548364400416034343698204186575808495618';
    const mockProof = { pi_a: [], pi_b: [], pi_c: [] };

    await expect(
      verifier.verifyBatch([invalidNullifier], mockProof, ['1'])
    ).rejects.toThrow(/exceeds BN254 scalar field modulus/);
  });
});