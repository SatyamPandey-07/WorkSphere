import crypto from "crypto";
import { safeCompareSignatures } from "@/lib/security/hmac";
import {
  PASSPORT_SIGNING_KEY,
  computeNomadSignatureFingerprint,
} from "@/lib/zkp/nomadProof";

export interface StampAttestationVerificationInput {
  stampId?: string;
  badgeType?: string;
  nullifierHash?: string;
  epoch?: number | string;
  verificationSignature?: string;
  issuedAt?: string;
}

export interface StampAttestationVerificationResult {
  status: "verified" | "pending" | "invalid";
  verified: boolean;
  timestamp: string | null;
  signatureFingerprint: string | null;
  error?: string;
}

/**
 * Server-side authoritative verification of a Passport stamp's cryptographic attestation.
 * Recomputes HMAC-SHA256 signature using the server's private PASSPORT_SIGNING_KEY
 * and compares in constant-time using safeCompareSignatures.
 */
export function verifyServerPassportStampAttestation(
  input: StampAttestationVerificationInput,
): StampAttestationVerificationResult {
  const {
    stampId,
    badgeType,
    nullifierHash,
    epoch,
    verificationSignature,
    issuedAt,
  } = input;

  // 1. Check for missing critical data
  if (
    !stampId ||
    !badgeType ||
    !nullifierHash ||
    epoch === undefined ||
    epoch === null
  ) {
    return {
      status: "invalid",
      verified: false,
      timestamp: null,
      signatureFingerprint: null,
      error: "Missing required stamp identity fields.",
    };
  }

  // 2. Check if signature is missing or designated as an offline pending stamp
  if (
    !verificationSignature ||
    verificationSignature === "pending_server_verification" ||
    verificationSignature === "offline_pending"
  ) {
    return {
      status: "pending",
      verified: false,
      timestamp: issuedAt || null,
      signatureFingerprint: null,
      error: "Offline stamp has not yet received server verification.",
    };
  }

  // 3. Recreate the canonical server signature payload
  const sigPayload = `${stampId}:${badgeType}:${nullifierHash}:${epoch}`;
  const expectedSignature = crypto
    .createHmac("sha256", PASSPORT_SIGNING_KEY)
    .update(sigPayload)
    .digest("hex");

  // 4. Verify signature in constant time
  const isMatch = safeCompareSignatures(
    verificationSignature,
    expectedSignature,
  );
  if (!isMatch) {
    return {
      status: "invalid",
      verified: false,
      timestamp: null,
      signatureFingerprint: null,
      error: "Cryptographic attestation signature mismatch or invalid.",
    };
  }

  // 5. Valid signature: compute fingerprint and return verified status
  const fingerprint = computeNomadSignatureFingerprint(verificationSignature);
  return {
    status: "verified",
    verified: true,
    timestamp: issuedAt || new Date().toISOString(),
    signatureFingerprint: fingerprint,
  };
}
