/**
 * DeepWorkCircuit.ts
 * Defines the logic for the Zero-Knowledge circuit to prove continuous application 
 * focus and active input without exposing the payload or specific application names.
 */

export interface FocusWitness {
    sessionId: string;
    startTime: number;
    endTime: number;
    totalActiveSeconds: number;
    inputCadenceHash: string; // Hash of keystroke/mouse intervals to prove human presence
    appFocusBitmap: Uint8Array; // Bitmap representing 1-minute intervals of focus
}

export interface PublicInputs {
    sessionId: string;
    durationMinutes: number;
    focusThresholdPercentage: number;
    merkleRoot: string; // Root of the user's historical session ledger
}

export class DeepWorkCircuit {
    private readonly INTERVAL_SECONDS = 60; // 1-minute granularity

    constructor() { }

    /**
     * Validates the witness data against the public inputs to ensure the proof is valid.
     * This mimics the constraints that would be compiled into a Circom/Arkworks circuit.
     */
    public validateConstraints(witness: FocusWitness, publicInputs: PublicInputs): boolean {
        // Constraint 1: Duration must match
        const actualDurationMin = Math.floor((witness.endTime - witness.startTime) / 60000);
        if (actualDurationMin !== publicInputs.durationMinutes) {
            console.error('Constraint 1 Failed: Duration mismatch');
            return false;
        }

        // Constraint 2: Active time must meet the threshold percentage
        const totalPossibleSeconds = actualDurationMin * 60;
        const actualPercentage = (witness.totalActiveSeconds / totalPossibleSeconds) * 100;
        if (actualPercentage < publicInputs.focusThresholdPercentage) {
            console.error('Constraint 2 Failed: Focus threshold not met');
            return false;
        }

        // Constraint 3: Bitmap length must match duration
        const expectedBitmapLength = Math.ceil(actualDurationMin / 8); // 8 bits per byte
        if (witness.appFocusBitmap.length !== expectedBitmapLength) {
            console.error('Constraint 3 Failed: Bitmap length mismatch');
            return false;
        }

        // Constraint 4: Sum of set bits in bitmap must equal totalActiveSeconds / 60
        const setBits = this.countSetBits(witness.appFocusBitmap);
        const expectedActiveMinutes = Math.floor(witness.totalActiveSeconds / this.INTERVAL_SECONDS);
        if (setBits !== expectedActiveMinutes) {
            console.error('Constraint 4 Failed: Bitmap sum mismatch');
            return false;
        }

        // Constraint 5: Input cadence hash must be non-zero (proves human interaction)
        if (witness.inputCadenceHash === '0x00000000' || witness.inputCadenceHash.length < 10) {
            console.error('Constraint 5 Failed: Invalid human presence hash');
            return false;
        }

        return true;
    }

    /**
     * Generates a mock Groth16 proof structure. 
     * In production, this would invoke the WASM snarkjs prover.
     */
    public generateMockProof(witness: FocusWitness, publicInputs: PublicInputs): any {
        const isValid = this.validateConstraints(witness, publicInputs);
        if (!isValid) throw new Error('Circuit constraints not satisfied');

        // Simulate the elliptic curve points (A, B, C) of a Groth16 proof
        return {
            pi_a: ['0x123...', '0x456...'],
            pi_b: [['0x789...', '0xabc...'], ['0xdef...', '0x111...']],
            pi_c: ['0x222...', '0x333...'],
            protocol: 'groth16',
            curve: 'bn128'
        };
    }

    private countSetBits(bitmap: Uint8Array): number {
        let count = 0;
        for (let i = 0; i < bitmap.length; i++) {
            let byte = bitmap[i];
            while (byte) {
                count += byte & 1;
                byte >>= 1;
            }
        }
        return count;
    }

    /**
     * Hashes the private witness data to generate the public commitment.
     */
    public hashWitness(witness: FocusWitness): string {
        const data = `${witness.sessionId}:${witness.startTime}:${witness.endTime}:${witness.inputCadenceHash}`;
        return this.simpleHash(data);
    }

    private simpleHash(str: string): string {
        let hash = 0x811c9dc5; // FNV offset basis
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193); // FNV prime
        }
        return '0x' + (hash >>> 0).toString(16).padStart(8, '0');
    }
}
