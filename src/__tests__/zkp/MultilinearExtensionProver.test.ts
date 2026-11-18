import { MultilinearExtensionProver } from '../../core/zkp/MultilinearExtensionProver';

describe('MultilinearExtensionProver', () => {
  it('proves and verifies degree-2 LFKN product sumcheck over 4-variate hypercube', () => {
    const prover = new MultilinearExtensionProver(4);
    const fTable = Array.from({ length: 16 }, (_, i) => BigInt(i * 3 + 5));
    const gTable = Array.from({ length: 16 }, (_, i) => BigInt((i + 1) * 7));

    const proof = prover.proveProductSumcheck(fTable, gTable);
    const result = prover.verifyProductSumcheck(fTable, gTable, proof);

    expect(result.isValid).toBe(true);
    expect(result.verifiedRounds).toBe(4);
    expect(result.finalExpectedClaim).toBe(result.finalOracleProduct);
  });

  it('supports linear MLE sumcheck proofs', () => {
    const prover = new MultilinearExtensionProver(3);
    const fTable = [2n, 4n, 6n, 8n, 10n, 12n, 14n, 16n];
    const ones = new Array<bigint>(8).fill(1n);

    const proof = prover.proveLinearSumcheck(fTable);
    expect(proof.claimedSum).toBe(72n);
    expect(prover.verifyProductSumcheck(fTable, ones, proof).isValid).toBe(true);
  });

  it('rejects tampered claimed sum or round polynomial coefficients', () => {
    const prover = new MultilinearExtensionProver(3);
    const fTable = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
    const gTable = [8n, 7n, 6n, 5n, 4n, 3n, 2n, 1n];
    const proof = prover.proveProductSumcheck(fTable, gTable);

    expect(
      prover.verifyProductSumcheck(fTable, gTable, { ...proof, claimedSum: proof.claimedSum + 1n }).isValid
    ).toBe(false);

    const badRounds = [...proof.rounds];
    badRounds[1] = {
      ...badRounds[1],
      coeffs: [badRounds[1].coeffs[0] + 1n, badRounds[1].coeffs[1], badRounds[1].coeffs[2]],
    };
    expect(prover.verifyProductSumcheck(fTable, gTable, { ...proof, rounds: badRounds }).isValid).toBe(false);
  });
});
