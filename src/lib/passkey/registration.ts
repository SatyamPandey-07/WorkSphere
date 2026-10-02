/**
 * Shared WebAuthn registration verification used by both first-time
 * registration and passkey rotation (#1991).
 */

import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/browser";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseClientDataJSON } from "@/lib/webauthn";
import { getRpId, getExpectedOrigin } from "@/lib/passkey";
import { getKeyExpiryDate } from "./attestation";

export type VerifiedRegistration = {
  challengeId: string;
  credential: {
    credentialId: string;
    publicKey: Prisma.PasskeyCredentialUncheckedCreateInput["publicKey"];
    counter: bigint;
    transports: string[];
    deviceType: string;
    backedUp: boolean;
    aaguid: string | null;
    expiresAt: Date;
  };
};

export type RegistrationResult =
  | { ok: true; registration: VerifiedRegistration }
  | { ok: false; status: 400; error: string };

/**
 * Verify a registration response against the user's latest unexpired
 * challenge. Does not persist anything — callers decide how to store the
 * credential (plain insert vs. rotation transaction) and must delete the
 * spent challenge.
 */
export async function verifyPasskeyRegistration(
  req: Request,
  userId: string,
  registrationResponse: RegistrationResponseJSON,
): Promise<RegistrationResult> {
  const challengeRecord = await prisma.passkeyChallenge.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!challengeRecord) {
    return {
      ok: false,
      status: 400,
      error: "Passkey challenge expired or missing. Please try again.",
    };
  }

  const clientData = registrationResponse.response?.clientDataJSON
    ? parseClientDataJSON(registrationResponse.response.clientDataJSON)
    : null;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: getExpectedOrigin(req, clientData?.origin),
      expectedRPID: getRpId(req),
    });
  } catch {
    // Malformed / mismatched responses are client errors, not server faults.
    return { ok: false, status: 400, error: "Passkey verification failed" };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, status: 400, error: "Passkey verification failed" };
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
    verification.registrationInfo;

  return {
    ok: true,
    registration: {
      challengeId: challengeRecord.id,
      credential: {
        credentialId: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports || [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        aaguid: aaguid || null,
        expiresAt: getKeyExpiryDate(),
      },
    },
  };
}
