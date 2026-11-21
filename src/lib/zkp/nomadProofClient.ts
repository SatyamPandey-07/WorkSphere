import type { NomadProofChallenge, NomadProofPayload } from "./nomadProof";

/**
 * Runs actual Groth16 proof generation in a browser Web Worker.
 * The proof is independently verified by the authenticated API.
 */
export async function generateClientNomadProof(
  challenge: NomadProofChallenge,
): Promise<NomadProofPayload> {
  if (
    !challenge ||
    !challenge.statement ||
    !challenge.input ||
    !/^[0-9]+$/.test(challenge.input.identitySecret) ||
    !/^[0-9]+$/.test(challenge.input.expectedCommitment)
  ) {
    throw new Error("Invalid Nomad proof challenge.");
  }

  if (typeof Worker === "undefined") {
    throw new Error("Web Workers are unavailable in this browser.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const worker = new Worker(
      new URL("../../workers/nomadProofWorker.ts", import.meta.url),
      { type: "module" },
    );

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      callback();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error("Nomad proof generation timed out after 60 seconds.")),
      );
    }, 60_000);

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;

      if (message?.type === "success") {
        finish(() =>
          resolve({
            proof: message.proof,
            publicSignals: message.publicSignals,
          }),
        );
        return;
      }

      if (message?.type === "error") {
        finish(() =>
          reject(new Error(message.error || "Nomad proof generation failed.")),
        );
      }
    };

    worker.onerror = (event) => {
      finish(() =>
        reject(new Error(event.message || "Nomad proof worker failed.")),
      );
    };

    worker.postMessage({
      type: "prove",
      input: challenge.input,
    });
  });
}
