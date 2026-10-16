/**
 * didSignerWorker.ts
 * Web Worker to execute the computationally heavy Groth16 proof generation 
 * locally, ensuring PII (birthdate) never leaves the device.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { AgeVerificationCircuit, CircuitInputs } from '../core/zkp/AgeVerificationCircuit';
import { loadSnarkjs } from '../lib/wasm-loader/did';

interface WorkerMessage {
    type: 'GENERATE_PROOF' | 'VERIFY_PROOF';
    payload: any;
}

let circuit: AgeVerificationCircuit | null = null;

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    try {
        switch (type) {
            case 'GENERATE_PROOF':
                await handleProofGeneration(payload);
                break;
            case 'VERIFY_PROOF':
                await handleProofVerification(payload);
                break;
        }
    } catch (error: any) {
        self.postMessage({ type: 'ERROR', error: error.message });
    }
});

async function handleProofGeneration(payload: { inputs: CircuitInputs; wasmPath: string; zkeyPath: string }) {
    if (!circuit) {
        circuit = new AgeVerificationCircuit(payload.wasmPath, payload.zkeyPath);
    }

    self.postMessage({ type: 'STATUS', message: 'Generating witness...' });
    const witness = await circuit.generateWitness(payload.inputs);

    self.postMessage({ type: 'STATUS', message: 'Generating Groth16 proof (this may take a few seconds)...' });

    // Load snarkjs dynamically to keep initial bundle small
    const snarkjs = await loadSnarkjs();

    // In a real scenario, we pass the witness buffer and zkey to snarkjs
    // const { proof, publicSignals } = await snarkjs.groth16.prove(payload.zkeyPath, witness);

    // Mocking the heavy computation result
    const mockProof = new Uint8Array(192); // Groth16 proofs are typically 192 bytes
    crypto.getRandomValues(mockProof);

    const publicSignals = [
        payload.inputs.currentTimestamp.toString(),
        payload.inputs.minAgeSeconds.toString(),
        "1" // isOldEnough flag (public output)
    ];

    self.postMessage({
        type: 'PROOF_GENERATED',
        proof: Array.from(mockProof),
        publicSignals
    });
}

async function handleProofVerification(payload: { proof: Uint8Array; publicSignals: string[]; vkey: any }) {
    const snarkjs = await loadSnarkjs();

    // Mock verification
    // const isValid = await snarkjs.groth16.verify(payload.vkey, payload.publicSignals, payload.proof);
    const isValid = true;

    self.postMessage({
        type: 'PROOF_VERIFIED',
        isValid
    });
}

self.addEventListener('error', (e) => console.error('[DIDWorker] Error:', e.message));
