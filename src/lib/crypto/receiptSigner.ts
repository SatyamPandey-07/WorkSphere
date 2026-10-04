import crypto from "crypto";

export type SignatureAlgorithm = "RSA-SHA256" | "ECDSA-P256" | "ECDSA-P384";

export interface ReservationReceiptPayload {
  bookingId: string;
  confirmationId: string;
  venueId: string;
  venueName: string;
  userId: string;
  userEmail?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationHours?: number;
  totalAmount: number;
  currency: string;
  issuedAt: string; // ISO timestamp
  status: string;
}

export interface CryptographicReceiptSignature {
  signature: string; // Base64 encoded signature
  algorithm: SignatureAlgorithm;
  publicKeyPem: string;
  digest: string; // SHA-256 hex digest of canonical payload
  canonicalPayload: string; // Canonical JSON string
  signedAt: string; // ISO timestamp
  keyId?: string;
}

export interface ReceiptVerificationResult {
  valid: boolean;
  algorithm: SignatureAlgorithm;
  digestMatches: boolean;
  signerIdentity?: string;
  error?: string;
  timestamp?: string;
}

/**
 * Deterministically creates a canonical JSON string for signing by sorting keys.
 */
export function canonicalizeReceiptPayload(payload: ReservationReceiptPayload): string {
  const sortedKeys = Object.keys(payload).sort() as (keyof ReservationReceiptPayload)[];
  const sortedObj: Record<string, any> = {};
  for (const k of sortedKeys) {
    if (payload[k] !== undefined) {
      sortedObj[k] = payload[k];
    }
  }
  return JSON.stringify(sortedObj);
}

/**
 * Computes SHA-256 digest of the canonical receipt payload.
 */
export function computeReceiptDigest(canonicalJson: string): string {
  return crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

// In-memory or default signing keypairs for WorkSphere receipt authority
let defaultRsaKeyPair: { publicKey: string; privateKey: string } | null = null;
let defaultEcdsaKeyPair: { publicKey: string; privateKey: string } | null = null;

export function generateReceiptKeyPair(type: "RSA" | "ECDSA" = "RSA"): {
  publicKeyPem: string;
  privateKeyPem: string;
} {
  if (type === "RSA") {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
  } else {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1", // P-256
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
  }
}

function getDefaultKeyPair(algorithm: SignatureAlgorithm): {
  publicKeyPem: string;
  privateKeyPem: string;
} {
  if (algorithm === "RSA-SHA256") {
    if (!defaultRsaKeyPair) {
      const generated = generateReceiptKeyPair("RSA");
      defaultRsaKeyPair = {
        publicKey: generated.publicKeyPem,
        privateKey: generated.privateKeyPem,
      };
    }
    return {
      publicKeyPem: defaultRsaKeyPair.publicKey,
      privateKeyPem: defaultRsaKeyPair.privateKey,
    };
  } else {
    if (!defaultEcdsaKeyPair) {
      const generated = generateReceiptKeyPair("ECDSA");
      defaultEcdsaKeyPair = {
        publicKey: generated.publicKeyPem,
        privateKey: generated.privateKeyPem,
      };
    }
    return {
      publicKeyPem: defaultEcdsaKeyPair.publicKey,
      privateKeyPem: defaultEcdsaKeyPair.privateKey,
    };
  }
}

/**
 * Cryptographically signs a reservation receipt payload using RSA or ECDSA.
 */
export function signReservationReceipt(
  payload: ReservationReceiptPayload,
  options: {
    algorithm?: SignatureAlgorithm;
    privateKeyPem?: string;
    publicKeyPem?: string;
    keyId?: string;
  } = {}
): CryptographicReceiptSignature {
  const algorithm = options.algorithm || "RSA-SHA256";
  const keys =
    options.privateKeyPem && options.publicKeyPem
      ? { privateKeyPem: options.privateKeyPem, publicKeyPem: options.publicKeyPem }
      : getDefaultKeyPair(algorithm);

  const canonicalPayload = canonicalizeReceiptPayload(payload);
  const digest = computeReceiptDigest(canonicalPayload);

  let signatureBase64: string;

  if (algorithm === "RSA-SHA256") {
    const signer = crypto.createSign("SHA256");
    signer.update(canonicalPayload, "utf8");
    signer.end();
    signatureBase64 = signer.sign(
      {
        key: keys.privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      "base64"
    );
  } else {
    // ECDSA
    const hashType = algorithm === "ECDSA-P384" ? "SHA384" : "SHA256";
    const signer = crypto.createSign(hashType);
    signer.update(canonicalPayload, "utf8");
    signer.end();
    signatureBase64 = signer.sign(
      {
        key: keys.privateKeyPem,
        dsaEncoding: "der",
      },
      "base64"
    );
  }

  return {
    signature: signatureBase64,
    algorithm,
    publicKeyPem: keys.publicKeyPem,
    digest,
    canonicalPayload,
    signedAt: new Date().toISOString(),
    keyId: options.keyId || "worksphere-authority-1",
  };
}

/**
 * Cryptographically verifies an RSA or ECDSA digital signature against receipt data.
 */
export function verifyReservationReceipt(
  payload: ReservationReceiptPayload,
  signatureBase64: string,
  publicKeyPem: string,
  algorithm: SignatureAlgorithm = "RSA-SHA256"
): ReceiptVerificationResult {
  try {
    const canonicalPayload = canonicalizeReceiptPayload(payload);
    const expectedDigest = computeReceiptDigest(canonicalPayload);

    let isValid = false;

    if (algorithm === "RSA-SHA256") {
      const verifier = crypto.createVerify("SHA256");
      verifier.update(canonicalPayload, "utf8");
      verifier.end();
      isValid = verifier.verify(
        {
          key: publicKeyPem,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(signatureBase64, "base64")
      );
    } else {
      // ECDSA
      const hashType = algorithm === "ECDSA-P384" ? "SHA384" : "SHA256";
      const verifier = crypto.createVerify(hashType);
      verifier.update(canonicalPayload, "utf8");
      verifier.end();
      isValid = verifier.verify(
        {
          key: publicKeyPem,
          dsaEncoding: "der",
        },
        Buffer.from(signatureBase64, "base64")
      );
    }

    return {
      valid: isValid,
      algorithm,
      digestMatches: true,
      signerIdentity: "WorkSphere Cryptographic Authority",
      timestamp: new Date().toISOString(),
    };
  } catch (err: unknown) {
    return {
      valid: false,
      algorithm,
      digestMatches: false,
      error: err instanceof Error ? err.message : "Invalid cryptographic signature format",
    };
  }
}

/**
 * Verifies raw buffer data (e.g. PDF receipt bytes) against RSA/ECDSA signature.
 */
export function verifyRawBufferSignature(
  dataBuffer: Uint8Array | Buffer,
  signatureBase64: string,
  publicKeyPem: string,
  algorithm: SignatureAlgorithm = "RSA-SHA256"
): boolean {
  try {
    const hashType = algorithm === "ECDSA-P384" ? "SHA384" : "SHA256";
    const verifier = crypto.createVerify(hashType);
    verifier.update(dataBuffer);
    verifier.end();

    if (algorithm === "RSA-SHA256") {
      return verifier.verify(
        {
          key: publicKeyPem,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(signatureBase64, "base64")
      );
    } else {
      return verifier.verify(
        {
          key: publicKeyPem,
          dsaEncoding: "der",
        },
        Buffer.from(signatureBase64, "base64")
      );
    }
  } catch {
    return false;
  }
}
