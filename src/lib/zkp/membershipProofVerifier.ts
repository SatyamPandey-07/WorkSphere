import { createHash } from 'crypto';

export interface SnarkJsProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol?: string;
  curve?: string;
}

export interface MembershipProofPayload {
  proof: SnarkJsProof;
  publicSignals: string[];
  deskId: string;
  slotWindow: string;
  verificationKey?: unknown;
}

export interface ProofVerificationResult {
  valid: boolean;
  proofHash: string;
  merkleRoot?: string;
  reason?: string;
}

export type Groth16VerifyFn = (
  vKey: unknown,
  publicSignals: string[],
  proof: SnarkJsProof
) => Promise<boolean> | boolean;

function isValidProofStructure(proof: unknown): proof is SnarkJsProof {
  if (!proof || typeof proof !== 'object') return false;
  const p = proof as Record<string, unknown>;
  return (
    Array.isArray(p.pi_a) &&
    p.pi_a.length >= 2 &&
    Array.isArray(p.pi_b) &&
    p.pi_b.length >= 2 &&
    Array.isArray(p.pi_c) &&
    p.pi_c.length >= 2
  );
}

export function computeMembershipProofHash(
  payload: Pick<MembershipProofPayload, 'proof' | 'publicSignals' | 'deskId' | 'slotWindow'>
): string {
  const canonical = JSON.stringify({
    deskId: payload.deskId,
    slotWindow: payload.slotWindow,
    publicSignals: payload.publicSignals,
    proof: {
      pi_a: payload.proof.pi_a,
      pi_b: payload.proof.pi_b,
      pi_c: payload.proof.pi_c,
    },
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export async function verifyMembershipProof(
  payload: MembershipProofPayload,
  groth16Verify?: Groth16VerifyFn
): Promise<ProofVerificationResult> {
  const proofHash = computeMembershipProofHash(payload);

  if (!isValidProofStructure(payload.proof)) {
    return { valid: false, proofHash, reason: 'INVALID_PROOF_STRUCTURE' };
  }

  if (!Array.isArray(payload.publicSignals) || payload.publicSignals.length < 3) {
    return { valid: false, proofHash, reason: 'INSUFFICIENT_PUBLIC_SIGNALS' };
  }

  const [merkleRoot, tierSignal, depositAuthorizedSignal] = payload.publicSignals;
  if (!merkleRoot || tierSignal === '0' || depositAuthorizedSignal !== '1') {
    return { valid: false, proofHash, merkleRoot, reason: 'ELIGIBILITY_CHECK_FAILED' };
  }

  if (groth16Verify) {
    const ok = await groth16Verify(
      payload.verificationKey ?? {},
      payload.publicSignals,
      payload.proof
    );
    if (!ok) {
      return { valid: false, proofHash, merkleRoot, reason: 'SNARKJS_VERIFY_FAILED' };
    }
  }

  return {
    valid: true,
    proofHash,
    merkleRoot,
  };
}