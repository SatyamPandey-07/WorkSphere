import { verifyMembershipProof, ZkProofPayload } from "./verify";
import { poseidonHash } from "./poseidon";

export interface MultiVenueBatchProofItem {
  venueId: string;
  proof: ZkProofPayload["proof"];
  publicSignals: string[];
  signature?: string;
}

export interface MultiVenueBatchVerifyRequest {
  clusterId: string;
  clusterMerkleRoot: string;
  venueProofs: MultiVenueBatchProofItem[];
}

export interface MultiVenueBatchVerifyResponse {
  valid: boolean;
  verifiedCount: number;
  totalCount: number;
  results: {
    venueId: string;
    valid: boolean;
    error?: string;
  }[];
  clusterHash: string;
}

export function computeClusterMerkleHash(venueIds: string[]): string {
  if (!venueIds || venueIds.length === 0) return "0";
  const sorted = [...venueIds].sort();
  const hashes = sorted.map((id) =>
    poseidonHash([BigInt(id.replace(/\D/g, "") || "1")]),
  );
  return hashes
    .reduce((acc, h) => poseidonHash([BigInt(acc), BigInt(h)]).toString(), "0");
}

export async function verifyMultiVenueBatchProofs(
  request: MultiVenueBatchVerifyRequest,
): Promise<MultiVenueBatchVerifyResponse> {
  const results = [];
  let verifiedCount = 0;

  for (const item of request.venueProofs) {
    try {
      const isValid = await verifyMembershipProof(
        item.proof,
        item.publicSignals,
      );
      if (isValid) {
        verifiedCount++;
        results.push({ venueId: item.venueId, valid: true });
      } else {
        results.push({
          venueId: item.venueId,
          valid: false,
          error: "Invalid ZK proof",
        });
      }
    } catch (err: any) {
      results.push({
        venueId: item.venueId,
        valid: false,
        error: err?.message || "Verification failed",
      });
    }
  }

  const clusterHash = computeClusterMerkleHash(
    request.venueProofs.map((v) => v.venueId),
  );

  return {
    valid:
      verifiedCount === request.venueProofs.length &&
      request.venueProofs.length > 0,
    verifiedCount,
    totalCount: request.venueProofs.length,
    results,
    clusterHash,
  };
}
