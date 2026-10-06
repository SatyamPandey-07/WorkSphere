import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/browser";
import { prisma } from "@/lib/prisma";
import { parseClientDataJSON } from "@/lib/crypto/encoding";
import { KEY_EXPIRY_DAYS, type RegistrationResult } from "../types";
import { getRpId, getExpectedOrigin } from "./rpConfig";

export function getKeyExpiryDate(createdAt: Date = new Date()): Date {
  const expiry = new Date(createdAt);
  expiry.setDate(expiry.getDate() + KEY_EXPIRY_DAYS);
  return expiry;
}

export function isKeyExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

export function daysUntilExpiry(expiresAt: Date): number {
  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function shouldPromptRotation(expiresAt: Date): boolean {
  const days = daysUntilExpiry(expiresAt);
  return days > 0 && days <= 14;
}

export async function verifyPackedAttestation(
  attStmt: Record<string, unknown>,
  authenticatorData: Uint8Array,
  clientDataHash: Uint8Array,
): Promise<{ verified: boolean; trustPath?: string[] }> {
  if (!attStmt || typeof attStmt !== "object") return { verified: false };

  const attStmtSig = attStmt.sig as Uint8Array | undefined;
  const attStmtX5c = attStmt.x5c as Uint8Array[] | undefined;

  if (!attStmtSig) {
    return { verified: false };
  }

  if (attStmtX5c && Array.isArray(attStmtX5c) && attStmtX5c.length > 0) {
    const leafCert = attStmtX5c[0];
    if (!leafCert) return { verified: false };

    const toBeSigned = new Uint8Array([
      ...authenticatorData,
      ...clientDataHash,
    ]);

    const certDerBuf = Buffer.from(leafCert);
    const publicKey = await importPublicKeyFromCert(certDerBuf);
    if (!publicKey) return { verified: false };

    const valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      attStmtSig as unknown as BufferSource,
      toBeSigned as unknown as BufferSource,
    );

    return {
      verified: valid,
      trustPath: attStmtX5c.map((cert) => Buffer.from(cert).toString("base64")),
    };
  }

  return { verified: false };
}

export async function verifyAndroidKeyAttestation(
  attStmt: Record<string, unknown>,
  authenticatorData: Uint8Array,
  clientDataHash: Uint8Array,
): Promise<{ verified: boolean; trustPath?: string[] }> {
  if (!attStmt || typeof attStmt !== "object") return { verified: false };

  const attStmtSig = attStmt.sig as Uint8Array | undefined;
  const x5c = attStmt.x5c as Uint8Array[] | undefined;

  if (!attStmtSig || !x5c || !Array.isArray(x5c) || x5c.length === 0) {
    return { verified: false };
  }

  const leafCert = x5c[0];
  if (!leafCert) return { verified: false };
  const toVerify = new Uint8Array([...authenticatorData, ...clientDataHash]);

  const certDerBuf = Buffer.from(leafCert);
  const publicKey = await importPublicKeyFromCert(certDerBuf);
  if (!publicKey) return { verified: false };

  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    attStmtSig as unknown as BufferSource,
    toVerify as unknown as BufferSource,
  );

  return {
    verified: valid,
    trustPath: x5c.map((cert) => Buffer.from(cert).toString("base64")),
  };
}

export function verifyNoneAttestation(attStmt: Record<string, unknown>): {
  verified: boolean;
} {
  if (!attStmt || typeof attStmt !== "object") {
    return { verified: false };
  }

  if (Object.keys(attStmt).length !== 0) {
    return { verified: false };
  }

  return { verified: true };
}

async function importPublicKeyFromCert(
  _certDer: Buffer,
): Promise<CryptoKey | null> {
  try {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["verify"],
    );
    return keyPair.publicKey;
  } catch {
    return null;
  }
}

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
      response: registrationResponse as any,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: getExpectedOrigin(req, clientData?.origin as string | undefined),
      expectedRPID: getRpId(req),
    });
  } catch {
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
