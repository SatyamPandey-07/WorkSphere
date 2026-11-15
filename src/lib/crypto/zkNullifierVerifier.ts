import fs from "fs";
import path from "path";

export interface ZkNullifierProof {
  proof: unknown;
  publicSignals: string[];
}

export interface ZkNullifierVerificationResult {
  valid: boolean;
}

let cachedVerificationKey: unknown;

function loadVerificationKey(): unknown {
  if (cachedVerificationKey) return cachedVerificationKey;

  const keyPath = path.join(
    process.cwd(),
    "public",
    "zkp",
    "verification_key.json",
  );
  cachedVerificationKey = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  return cachedVerificationKey;
}

export async function verifyZkNullifierProofs(
  proofs: ZkNullifierProof[],
): Promise<ZkNullifierVerificationResult[]> {
  const verificationKey = loadVerificationKey();
  const snarkjs = await import("snarkjs");

  return Promise.all(
    proofs.map(async ({ proof, publicSignals }) => {
      try {
        return {
          valid: await snarkjs.groth16.verify(
            verificationKey,
            publicSignals,
            proof,
          ),
        };
      } catch {
        return { valid: false };
      }
    }),
  );
}
