const KEY_EXPIRY_DAYS = 90;

export type AttestationFormat =
  "packed" | "android-key" | "android-safetynet" | "fido-u2f" | "none";

export interface AttestationVerificationResult {
  verified: boolean;
  attestationFormat: AttestationFormat;
  keyExpiryDate: Date;
  trustPath?: string[];
}

export async function verifyPackedAttestation(
  attStmt: Record<string, unknown>,
  authenticatorData: Uint8Array,
  clientDataHash: Uint8Array,
): Promise<{ verified: boolean; trustPath?: string[] }> {
  const attStmtSig = attStmt.sig as Uint8Array;
  const attStmtX5c = attStmt.x5c as Uint8Array[] | undefined;

  if (attStmtX5c && attStmtX5c.length > 0) {
    const leafCert = attStmtX5c[0];
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
      attStmtSig,
      toBeSigned,
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
  const attStmtSig = attStmt.sig as Uint8Array;
  const x5c = attStmt.x5c as Uint8Array[];

  if (!x5c || x5c.length === 0) {
    return { verified: false };
  }

  const leafCert = x5c[0];
  const toVerify = new Uint8Array([...authenticatorData, ...clientDataHash]);

  const certDerBuf = Buffer.from(leafCert);
  const publicKey = await importPublicKeyFromCert(certDerBuf);
  if (!publicKey) return { verified: false };

  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    attStmtSig,
    toVerify,
  );

  return {
    verified: valid,
    trustPath: x5c.map((cert) => Buffer.from(cert).toString("base64")),
  };
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
  return days <= 14;
}
