import path from "path";
import { computeMembershipCommit } from "./commitment";

export type ZkProofPayload = {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
};

interface VerificationKey {
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  IC: string[][];
}

function artifactPaths() {
  const root = path.join(process.cwd(), "public", "zkp");
  return {
    wasm: path.join(root, "premium_membership.wasm"),
    zkey: path.join(root, "premium_membership.zkey"),
    vkey: path.join(root, "verification_key.json"),
  };
}

async function loadSnarkjs() {
  return await import("snarkjs");
}

async function releaseCurve() {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (g.curve_bn128) {
    try {
      await g.curve_bn128.terminate();
    } catch {
      // ignore
    }
  }
}

const VERIFICATION_TIMEOUT_MS = 10_000;

/** Node: build a groth16 proof for a private identity token. */
export async function proveMembership(
  identityToken: string | number | bigint,
): Promise<ZkProofPayload & { ms: number }> {
  const snarkjs = await loadSnarkjs();
  const expectedCommit = computeMembershipCommit(identityToken);
  const { wasm, zkey } = artifactPaths();

  const started = Date.now();
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      {
        identityToken: identityToken.toString(),
        expectedCommit,
      },
      wasm,
      zkey,
    );
    return { proof, publicSignals, ms: Date.now() - started };
  } finally {
    await releaseCurve();
  }
}

let cachedVkey: VerificationKey | null = null;

/** Server-only: verify a proof. Does not accept or store identity tokens. */
export async function verifyMembershipProof(
  proof: ZkProofPayload["proof"],
  publicSignals: string[],
): Promise<boolean> {
  const snarkjs = await loadSnarkjs();
  if (!cachedVkey) {
    const fs = await import("fs/promises");
    const vkeyRaw = await fs.readFile(artifactPaths().vkey, "utf8");
    cachedVkey = JSON.parse(vkeyRaw);
  }
  try {
    return await Promise.race([
      snarkjs.groth16.verify(cachedVkey, publicSignals, proof),
      new Promise<boolean>((_, reject) =>
        setTimeout(
          () => reject(new Error("Verification timed out")),
          VERIFICATION_TIMEOUT_MS,
        ),
      ),
    ]);
  } finally {
    await releaseCurve();
  }
}

export async function isCommitmentRevoked(
  commitment: string,
  witness: string[],
): Promise<boolean> {
  const { getCurrentMerkleRoot, verifyMerkleProof } =
    await import("./revocation");
  const root = getCurrentMerkleRoot();
  return verifyMerkleProof(commitment, witness, root);
}
