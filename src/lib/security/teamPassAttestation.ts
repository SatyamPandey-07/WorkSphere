import { createHmac } from "node:crypto";
import { safeCompareSignatures } from "@/lib/security/hmac";

export interface TeamPassAttestationPayload {
  attestationId: string;
  venueId: string;
  memberId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

function isValidPayload(payload: TeamPassAttestationPayload): boolean {
  if (!payload || typeof payload !== "object") return false;

  const requiredStrings = [
    payload.attestationId,
    payload.venueId,
    payload.memberId,
    payload.nonce,
    payload.issuedAt,
    payload.expiresAt,
  ];

  if (
    requiredStrings.some(
      (value) =>
        typeof value !== "string" ||
        value.trim().length === 0 ||
        value.length > 512,
    )
  ) {
    return false;
  }

  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);

  return (
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt > issuedAt
  );
}

/**
 * Fixed-position serialization prevents property-order ambiguity.
 * The protocol version is included to support future format changes.
 */
function serializePayload(payload: TeamPassAttestationPayload): string {
  return JSON.stringify([
    "WORKSPHERE_TEAM_PASS_ATTESTATION_V1",
    payload.attestationId,
    payload.venueId,
    payload.memberId,
    payload.nonce,
    payload.issuedAt,
    payload.expiresAt,
  ]);
}

export function createTeamPassAttestationSignature(
  payload: TeamPassAttestationPayload,
  secret: string,
): string {
  if (!isValidPayload(payload)) {
    throw new Error("Invalid team pass attestation payload");
  }

  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error(
      "Team pass attestation secret must be at least 32 characters",
    );
  }

  return createHmac("sha256", secret)
    .update(serializePayload(payload), "utf8")
    .digest("hex");
}

export function verifyTeamPassAttestationSignature(
  payload: TeamPassAttestationPayload,
  signature: string,
  secret: string,
): boolean {
  try {
    if (
      !isValidPayload(payload) ||
      typeof secret !== "string" ||
      secret.length < 32
    ) {
      return false;
    }

    const expected = createHmac("sha256", secret)
      .update(serializePayload(payload), "utf8")
      .digest("hex");

    return safeCompareSignatures(signature, expected);
  } catch {
    return false;
  }
}
