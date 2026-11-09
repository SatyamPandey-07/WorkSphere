/**
 * ReputationCircuit.ts
 * Defines the logic for the Zero-Knowledge circuit to prove trust-depth without exposing the voucher identities.
 * This class prepares the inputs and validates the outputs of the compiled Circom circuit.
 */

export interface CircuitInputs {
  vouchCount: number;
  minTrustWeight: number;
  requiredVouchCount: number;
  requiredMinWeight: number;
  secretSalt: number;
}

export interface CircuitOutputs {
  isValid: number;
  commitment: number;
}

export class ReputationCircuit {
  private requiredVouchCount: number;
  private requiredMinWeight: number;

  constructor(requiredVouchCount: number = 3, requiredMinWeight: number = 5) {
    this.requiredVouchCount = requiredVouchCount;
    this.requiredMinWeight = requiredMinWeight;
  }

  /**
   * Generates the input signals for the ZK circuit.
   */
  public generateInputs(graphData: { vouchCount: number; minTrustWeight: number }, secretSalt: number): CircuitInputs {
    return {
      vouchCount: graphData.vouchCount,
      minTrustWeight: graphData.minTrustWeight,
      requiredVouchCount: this.requiredVouchCount,
      requiredMinWeight: this.requiredMinWeight,
      secretSalt: secretSalt
    };
  }

  /**
   * Simulates the circuit logic to verify if the inputs satisfy the constraints.
   * In production, this is enforced by the snarkjs verifier.
   */
  public simulateConstraintCheck(inputs: CircuitInputs): CircuitOutputs {
    const meetsVouchRequirement = inputs.vouchCount >= inputs.requiredVouchCount ? 1 : 0;
    const meetsWeightRequirement = inputs.minTrustWeight >= inputs.requiredMinWeight ? 1 : 0;
    
    const isValid = meetsVouchRequirement & meetsWeightRequirement;
    
    // Mock commitment hash (in production, this is Poseidon hash of inputs + salt)
    const commitment = (inputs.vouchCount * 1000) + (inputs.minTrustWeight * 100) + inputs.secretSalt;

    return { isValid, commitment };
  }

  /**
   * Returns the expected circuit artifact paths.
   */
  public getArtifactPaths(): { wasm: string; zkey: string; vkey: string } {
    return {
      wasm: '/zkp/reputation_circuit.wasm',
      zkey: '/zkp/reputation_circuit_final.zkey',
      vkey: '/zkp/reputation_circuit_verification_key.json'
    };
  }
}
