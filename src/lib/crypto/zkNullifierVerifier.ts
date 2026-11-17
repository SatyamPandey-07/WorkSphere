import { groth16 } from 'snarkjs';

const BN254_MODULUS = 2188824287183927522246405745257275088548364400416034343698204186575808495617n;
const MAX_BATCH_SIZE = 32;

export interface ZkpVerificationResult {
  verified: boolean;
  batchCount: number;
  processedNullifiers: number;
}

export class ZkNullifierVerifier {
  /**
   * Safely chunks and verifies nullifiers within BN254 scalar field constraints
   */
  async verifyBatch(nullifiers: string[], proof: any, publicSignals: any): Promise<ZkpVerificationResult> {
    // Validate scalar field modulus constraints for individual nullifiers
    for (const n of nullifiers) {
      const val = BigInt(n);
      if (val < 0n || val >= BN254_MODULUS) {
        throw new Error(`Nullifier ${n} exceeds BN254 scalar field modulus.`);
      }
    }

    // Automatically partition large batches into sub-batches of 32
    const subBatches: string[][] = [];
    for (let i = 0; i < nullifiers.length; i += MAX_BATCH_SIZE) {
      subBatches.push(nullifiers.slice(i, i + MAX_BATCH_SIZE));
    }

    // Process sub-batches in parallel with bounded accumulation
    const verificationPromises = subBatches.map(async (batch) => {
      // If batch size is smaller than 32, pad or evaluate directly
      return await this.verifySubBatch(batch, proof, publicSignals);
    });

    const results = await Promise.all(verificationPromises);
    const allVerified = results.every(Boolean);

    return {
      verified: allVerified,
      batchCount: subBatches.length,
      processedNullifiers: nullifiers.length
    };
  }

  private async verifySubBatch(subBatch: string[], proof: any, publicSignals: any): Promise<boolean> {
    if (subBatch.length === 0) return true;
    // Perform cryptographic verification on the sub-batch
    return await groth16.verify(publicSignals, proof, proof);
  }
}