/**
 * Web Worker to execute the computationally heavy Groth16 proof generation 
 * locally, ensuring travel data never leaves the device.
 */

import { ResidencyCircuit, ResidencyProofInput } from '../core/zkp/ResidencyCircuit';
import { loadZkpResidencyWasm, ZkpResidencyExports } from '../lib/wasm-loader/zkp_residency';

let zkpExports: ZkpResidencyExports | null = null;

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        try {
            zkpExports = await loadZkpResidencyWasm();
            self.postMessage({ type: 'READY' });
        } catch (err: any) {
            self.postMessage({ type: 'ERROR', message: `Failed to load ZKP WASM: ${err.message}` });
        }
        return;
    }

    if (type === 'GENERATE_PROOF') {
        if (!zkpExports) {
            self.postMessage({ type: 'ERROR', message: 'ZKP WASM not initialized' });
            return;
        }

        try {
            const input: ResidencyProofInput = payload;

            // 1. Generate the witness locally
            const witness = ResidencyCircuit.generateWitness(input);
            const formattedWitness = ResidencyCircuit.formatForSnarkjs(witness);

            // 2. Generate the Groth16 proof using snarkjs WASM
            // In a real implementation, this calls snarkjs.groth16.fullProve
            const proofResult = await zkpExports.generateProof(
                formattedWitness,
                payload.zkeyBuffer, // The trusted setup artifacts
                payload.wasmBuffer  // The circuit WASM
            );

            self.postMessage({
                type: 'PROOF_GENERATED',
                payload: {
                    proof: proofResult.proof,
                    publicSignals: proofResult.publicSignals,
                    isValid: witness.isValid === 1n,
                }
            });
        } catch (err: any) {
            self.postMessage({ type: 'ERROR', message: `Proof generation failed: ${err.message}` });
        }
    }
};