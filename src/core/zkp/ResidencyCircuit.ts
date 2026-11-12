/**
 * Defines the Circom logic representation and witness generation for 
 * proving that the sum of days within a specific jurisdiction's geo-fence 
 * is below the legal tax threshold.
 * 
 * Note: In production, this would interface with a compiled .wasm/.zkey 
 * generated from a .circom file. Here we define the TypeScript witness generator.
 */

export interface ResidencyProofInput {
    sessions: {
        countryId: string;
        durationDays: number;
    }[];
    targetCountryId: string;
    thresholdDays: number; // e.g., 183
}

export interface ResidencyWitness {
    // Public inputs
    targetCountryIdHash: bigint;
    thresholdDays: bigint;
    isValid: bigint; // 1 if under threshold, 0 otherwise

    // Private inputs (hidden from verifier)
    sessionDurations: bigint[];
    sessionCountryHashes: bigint[];
    totalDays: bigint;
}

export class ResidencyCircuit {

    /**
     * Generates the witness data required for the Groth16 prover.
     * This simulates the constraint system evaluation.
     */
    public static generateWitness(input: ResidencyProofInput): ResidencyWitness {
        let totalDays = 0;
        const sessionDurations: bigint[] = [];
        const sessionCountryHashes: bigint[] = [];

        // Hash the target country ID to match the circuit's expected public input format
        const targetHash = this.simpleHash(input.targetCountryId);

        for (const session of input.sessions) {
            // In a real Circom circuit, we would use Poseidon hash for country IDs
            const countryHash = this.simpleHash(session.countryId);

            // Constraint: If countryHash == targetHash, add duration to total
            // In TS, we just calculate it for the witness
            if (session.countryId === input.targetCountryId) {
                totalDays += session.durationDays;
            }

            // Scale days to integers for the finite field (e.g., multiply by 100 for 2 decimal places)
            sessionDurations.push(BigInt(Math.round(session.durationDays * 100)));
            sessionCountryHashes.push(countryHash);
        }

        const totalDaysScaled = BigInt(Math.round(totalDays * 100));
        const thresholdScaled = BigInt(Math.round(input.thresholdDays * 100));

        // Constraint: totalDaysScaled < thresholdScaled
        const isValid = totalDaysScaled < thresholdScaled ? 1n : 0n;

        return {
            targetCountryIdHash: targetHash,
            thresholdDays: thresholdScaled,
            isValid,
            sessionDurations,
            sessionCountryHashes,
            totalDays: totalDaysScaled,
        };
    }

    /**
     * Simple hash function to simulate Poseidon hashing for the witness.
     * In production, use a proper cryptographic hash compatible with the ZK curve (e.g., BN128).
     */
    private static simpleHash(str: string): bigint {
        let hash = 0n;
        const prime = 21888242871839275222246405745257275088548364400416034343698204186575808495617n; // BN128 scalar field

        for (let i = 0; i < str.length; i++) {
            const char = BigInt(str.charCodeAt(i));
            hash = (hash * 31n + char) % prime;
        }

        return hash;
    }

    /**
     * Formats the witness into the flat array structure expected by snarkjs.
     */
    public static formatForSnarkjs(witness: ResidencyWitness): string[] {
        // Snarkjs expects a flat array of strings representing field elements
        // Order must match the signal declarations in the .circom file
        return [
            "1", // Constant 1 for the circuit
            witness.targetCountryIdHash.toString(),
            witness.thresholdDays.toString(),
            witness.isValid.toString(),
            witness.totalDays.toString(),
            ...witness.sessionDurations.map(d => d.toString()),
            ...witness.sessionCountryHashes.map(h => h.toString()),
        ];
    }
}
