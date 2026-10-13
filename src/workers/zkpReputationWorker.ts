/**
 * zkpReputationWorker.ts
 * Web Worker to execute the computationally heavy Groth16 proof generation locally on the client.
 * Ensures that the main thread remains responsive during ZKP computation.
 */

import { reputationWasm } from '@/lib/wasm-loader/reputation';
import { ReputationCircuit, CircuitInputs } from '@/core/zkp/ReputationCircuit';

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'GENERATE_PROOF') {
    try {
      const { inputs, artifactPaths } = payload as {
        inputs: CircuitInputs;
        artifactPaths: { wasm: string; zkey: string; vkey: string }
      };

      self.postMessage({ type: 'STATUS', payload: 'Generating Zero-Knowledge Proof...' });

      const { proof, publicSignals } = await reputationWasm.generateProof(
        inputs,
        artifactPaths.wasm,
        artifactPaths.zkey
      );

      self.postMessage({
        type: 'PROOF_GENERATED',
        payload: { proof, publicSignals }
      });
    } catch (error) {
      self.postMessage({
        type: 'ERROR',
        error: error instanceof Error ? error.message : 'Proof generation failed.'
      });
    }
  }

  if (type === 'VERIFY_PROOF') {
    try {
      const { vkey, publicSignals, proof } = payload;
      const isValid = await reputationWasm.verifyProof(vkey, publicSignals, proof);

      self.postMessage({ type: 'VERIFICATION_RESULT', payload: { isValid } });
    } catch (error) {
      self.postMessage({
        type: 'ERROR',
        error: error instanceof Error ? error.message : 'Proof verification failed.'
      });
    }
  }
};
